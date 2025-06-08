import axios from 'axios';
import crypto from 'crypto';
import { config } from '../config';
import { Position, AccountSummary, ExchangeData } from '../models/position.model';

export class BybitClient {
    private apiKey: string;
    private apiSecret: string;
    private baseUrl: string;
    private recvWindow: number = 60000;
    private lastValidData: ExchangeData;

    constructor() {
        this.apiKey = config.exchanges.bybit.apiKey;
        this.apiSecret = config.exchanges.bybit.apiSecret;
        this.baseUrl = config.exchanges.bybit.baseUrl;
        this.lastValidData = {
            positions: [],
            accountSummary: {
                exchange: 'bybit',
                accountId: 'unified',
                baseCurrency: 'USDT',
                baseBalance: 0,
                totalNotionalValue: 0,
                accountLeverage: 0,
                openPositionsCount: 0,
                openOrdersCount: 0,
                accountMarginRatio: 0,
                liquidationBuffer: 0
            }
        };
    }

    public async initialize(): Promise<void> {
        try {
            await this.getAccountInfo();
            console.log('Successfully initialized Bybit unified margin client');
        } catch (error) {
            console.error('Failed to initialize Bybit unified margin client:', error);
            throw error;
        }
    }

    private getTimestamp(): number {
        return Date.now();
    }

    private sign(queryParams: string, timestamp: string): string {
        const paramStr = timestamp + this.apiKey + this.recvWindow + queryParams;
        return crypto.createHmac('sha256', this.apiSecret).update(paramStr).digest('hex');
    }

    private async makeSignedRequest(endpoint: string, params: any = {}): Promise<any> {
        const timestamp = this.getTimestamp().toString();
        const queryParams = new URLSearchParams(params).toString();
        const sign = this.sign(queryParams, timestamp);

        const headers = {
            'X-BAPI-API-KEY': this.apiKey,
            'X-BAPI-SIGN': sign,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': this.recvWindow.toString(),
        };

        const url = `${this.baseUrl}${endpoint}${queryParams ? '?' + queryParams : ''}`;
        try {
            const response = await axios.get(url, { headers });
            return response.data.result || response.data;
        } catch (error: any) {
            if (error.response && error.response.data) {
                throw new Error(`Bybit API error: ${error.response.data.retMsg || JSON.stringify(error.response.data)}`);
            }
            throw error;
        }
    }

    private async getPositions(): Promise<any[]> {
        // Fetch both USDT and USDC linear futures positions
        const [usdtRes, usdcRes] = await Promise.all([
            this.makeSignedRequest('/v5/position/list', {
                category: 'linear',
                settleCoin: 'USDT',
                limit: 50
            }),
            this.makeSignedRequest('/v5/position/list', {
                category: 'linear',
                settleCoin: 'USDC',
                limit: 50
            })
        ]);

        const allPositions = [
            ...(usdtRes?.list || []),
            ...(usdcRes?.list || [])
        ];

        return allPositions.filter((pos: any) => parseFloat(pos.size) !== 0);
    }

    private async getAccountInfo(): Promise<any> {
        const res = await this.makeSignedRequest('/v5/account/wallet-balance', { accountType: 'UNIFIED' });

        if (!res.list?.[0]?.coin) {
            throw new Error('Invalid Bybit account info response structure');
        }

        return res.list[0];
    }

    private async getOpenOrders(): Promise<any[]> {
        const res = await this.makeSignedRequest('/v5/order/realtime', { category: 'linear' });
        return res.list || [];
    }

    private async getFundingRates(): Promise<any[]> {
        const res = await axios.get(`${this.baseUrl}/v5/market/tickers`, { params: { category: 'linear' } });
        return res.data.result.list || [];
    }

    private calculateLiquidationDistance(markPrice: number, liquidationPrice: number, side: string): number {
        if (liquidationPrice === 0) return 0;
        return Number(((side === 'LONG' ? liquidationPrice - markPrice : markPrice - liquidationPrice) / markPrice * 100).toFixed(2));
    }

    private calculateLiquidationPrice(
        entryPrice: number,
        positionSize: number,
        availableBalance: number,
        initialMargin: number,
        maintenanceMargin: number,
        side: string
    ): number {
        try {
            if (positionSize === 0) return 0;

            const marginDiff = availableBalance + initialMargin - maintenanceMargin;

            if (side === 'LONG') {
                return Number((entryPrice - (marginDiff / Math.abs(positionSize))).toFixed(2));
            } else {
                return Number((entryPrice + (marginDiff / Math.abs(positionSize))).toFixed(2));
            }
        } catch (error) {
            console.error('Error calculating liquidation price:', error);
            return 0;
        }
    }

    private mapPosition(pos: any, fundingRate: any): Position {
        const size = Number(Math.abs(parseFloat(pos.size)).toFixed(2));
        const entryPrice = Number(parseFloat(pos.avgPrice).toFixed(2));
        const markPrice = Number(parseFloat(pos.markPrice).toFixed(2));
        const side = pos.side === 'Buy' ? 'LONG' : 'SHORT';
        const leverage = Number(parseFloat(pos.leverage).toFixed(2));
        const unrealizedPnl = Number(parseFloat(pos.unrealisedPnl).toFixed(2));
        const realizedPnl = Number(parseFloat(pos.cumRealisedPnl || '0').toFixed(2));
        const notionalValue = Number(parseFloat(pos.positionValue).toFixed(2));

        // Calculate margins
        const initialMargin = notionalValue / leverage;
        const maintenanceMargin = initialMargin * 0.4; // Using 40% of initial margin as maintenance margin
        const availableBalance = Number(parseFloat(pos.walletBalance || '0').toFixed(2));

        // Calculate liquidation price
        const liquidationPrice = this.calculateLiquidationPrice(
            entryPrice,
            size,
            availableBalance,
            initialMargin,
            maintenanceMargin,
            side
        );

        const currentFundingRate = Number((fundingRate ? parseFloat(fundingRate.fundingRate) * 100 : 0).toFixed(2));
        const nextFundingRate = Number((fundingRate ? parseFloat(fundingRate.nextFundingRate || fundingRate.fundingRate) * 100 : 0).toFixed(2));
        const liquidationDistance = Number(this.calculateLiquidationDistance(markPrice, liquidationPrice, side).toFixed(2));

        // Map Bybit's tradeMode to our margin mode format
        const marginMode = pos.tradeMode === 1 ? 'ISOLATED' : 'CROSS';

        return {
            symbol: pos.symbol,
            side,
            size,
            notionalValue,
            entryPrice,
            markPrice,
            liquidationPrice,
            liquidationPriceChangePercent: liquidationDistance,
            currentFundingRate,
            nextFundingRate,
            leverage,
            unrealizedPnl,
            realizedPnl,
            marginMode,
            exchange: 'bybit'
        };
    }

    private async getAllAssetBalances(): Promise<any[]> {
        try {
            const response = await this.makeSignedRequest('/v5/account/wallet-balance', {
                accountType: 'UNIFIED',
            });

            if (!response?.list?.[0]?.coin) {
                return [];
            }

            // Return all coins with any kind of balance
            return response.list[0].coin.filter((asset: any) => {
                const walletBalance = parseFloat(asset.walletBalance || '0');
                const equity = parseFloat(asset.equity || '0');
                const totalWalletBalance = parseFloat(asset.totalWalletBalance || '0');
                const usdValue = parseFloat(asset.usdValue || '0');

                return walletBalance > 0 || equity > 0 || totalWalletBalance > 0 || usdValue > 0;
            });
        } catch (error) {
            console.error('Error fetching Bybit asset balances:', error);
            return [];
        }
    }

    private async getAssetPrice(symbol: string): Promise<number> {
        try {
            const response = await this.makeSignedRequest('/v5/market/tickers', {
                category: 'spot',
                symbol: `${symbol}USDT`
            });

            if (response?.result?.list?.[0]?.lastPrice) {
                return parseFloat(response.result.list[0].lastPrice);
            }
            return 0;
        } catch (error) {
            console.error(`Error fetching ${symbol} price:`, error);
            return 0;
        }
    }

    private async calculateTotalUSDTBalance(): Promise<number> {
        try {
            const response = await this.makeSignedRequest('/v5/account/wallet-balance', {
                accountType: 'UNIFIED',
            });

            if (!response?.list?.[0]) {
                return 0;
            }

            // Get the total wallet balance in USD directly from the API
            const totalWalletBalance = parseFloat(response.list[0].totalWalletBalance || '0');

            if (totalWalletBalance > 0) {
                return Number(totalWalletBalance.toFixed(2));
            }

            // Fallback: Calculate manually from individual coins
            const assets = response.list[0].coin || [];
            let totalUsdt = 0;

            for (const asset of assets) {
                // If USD value is directly provided by the API, use it
                const usdValue = parseFloat(asset.usdValue || '0');
                if (usdValue > 0) {
                    totalUsdt += usdValue;
                    continue;
                }

                const assetSymbol = asset.coin;
                // Try different balance fields
                const balance = parseFloat(asset.equity || asset.totalWalletBalance || asset.walletBalance || '0');

                if (balance <= 0) continue;

                if (assetSymbol === 'USDT') {
                    totalUsdt += balance;
                } else {
                    const usdtPrice = await this.getAssetPrice(assetSymbol);
                    totalUsdt += balance * usdtPrice;
                }
            }

            return Number(totalUsdt.toFixed(2));
        } catch (error) {
            console.error('Error calculating total USDT balance:', error);
            return 0;
        }
    }

    private async calculateTotalNotionalValue(positions: any[]): Promise<number> {
        let totalNotional = 0;

        for (const position of positions) {
            const size = Math.abs(parseFloat(position.size));
            const markPrice = parseFloat(position.markPrice);
            const notionalValue = size * markPrice;
            totalNotional += notionalValue;
        }

        return Number(totalNotional.toFixed(2));
    }

    private async processPositions(positionsData: any[]): Promise<Position[]> {
        // Get funding rates for all positions
        const fundingRates = await this.getFundingRates();

        return positionsData.map(pos => {
            const fundingRate = fundingRates.find(fr => fr.symbol === pos.symbol);
            return this.mapPosition(pos, fundingRate);
        });
    }

    public async getExchangeData(): Promise<ExchangeData> {
        try {
            // Get all necessary data
            const [accountInfo, positionsData, openOrders] = await Promise.all([
                this.getAccountInfo(),
                this.getPositions(),
                this.getOpenOrders()
            ]);

            // Process positions
            const positions = await this.processPositions(positionsData);

            // Calculate total balance in USDT considering all assets
            const baseBalance = await this.calculateTotalUSDTBalance();

            // Calculate total notional value from all positions
            const totalNotionalValue = await this.calculateTotalNotionalValue(positions);

            // Calculate weighted average leverage from all positions
            let accountLeverage = 0;
            if (positions.length > 0) {
                const weightedLeverageSum = positions.reduce((sum, position) => {
                    // Weight each position's leverage by its notional value
                    return sum + (position.leverage * position.notionalValue);
                }, 0);

                // Divide by total notional value to get weighted average
                accountLeverage = totalNotionalValue > 0 ?
                    Number((weightedLeverageSum / totalNotionalValue).toFixed(2)) : 0;
            }

            // Process account metrics
            const totalEquity = Number(parseFloat(accountInfo.totalEquity || '0').toFixed(2));
            const totalInitialMargin = Number(parseFloat(accountInfo.totalInitialMargin || '0').toFixed(2));
            const totalMaintenanceMargin = Number(parseFloat(accountInfo.totalMaintenanceMargin || '0').toFixed(2));

            // Calculate margin ratio (maintenance margin / equity) * 100
            const marginRatio = totalEquity > 0 ?
                Number(((totalMaintenanceMargin / totalEquity) * 100).toFixed(2)) : 0;

            // Calculate liquidation buffer ((equity - maintenance margin) / maintenance margin) * 100
            const liquidationBuffer = totalMaintenanceMargin > 0 ?
                Number(((totalEquity - totalMaintenanceMargin) / totalMaintenanceMargin * 100).toFixed(2)) : 0;

            console.log('Bybit Risk Metrics:', {
                marginRatio,
                liquidationBuffer
            });

            const accountSummary = {
                exchange: 'bybit',
                accountId: 'unified',
                baseCurrency: 'USDT',
                baseBalance,
                totalNotionalValue,
                accountLeverage,
                openPositionsCount: positions.length,
                openOrdersCount: openOrders.length,
                accountMarginRatio: marginRatio,
                liquidationBuffer: Math.min(liquidationBuffer, 100) // Cap at 100%
            };

            const data = {
                positions,
                accountSummary
            };

            this.lastValidData = data;
            return data;
        } catch (error) {
            console.error('Error fetching Bybit exchange data:', error);
            return this.lastValidData;
        }
    }
}


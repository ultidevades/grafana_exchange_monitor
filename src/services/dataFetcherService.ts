import { BinanceClient, BinanceAccountType } from '../exchanges/binance.client';
import { BybitClient } from '../exchanges/bybit.client';
// import { WebSocketService } from './websocketService';
import { CombinedData, ExchangeData } from '../models/position.model';

// Store exchange clients
const exchangeClients: { [key: string]: { [accountId: string]: BinanceClient | BybitClient } } = {
    binance: {},
    bybit: {}
};

// const exchangeClients: { [key: string]: { [accountId: string]: BinanceClient } } = {
//     binance: {},
// };

// Initialize WebSocket service
// const wsService = new WebSocketService();

// In-memory cache
let cachedData: CombinedData = {
    exchanges: {
        binance: {},
        bybit: {},
    },
    currentExchange: 'binance',
    currentAccount: 'futures',
    availableExchanges: ['binance', 'bybit'],
    // availableExchanges: ['binance'],

    availableAccounts: {
        binance: ['futures', 'portfolioMargin'],
        bybit: ['unified'],
    },
};

// Last successful fetch timestamps
const lastFetchTimes: { [exchange: string]: { [accountId: string]: number } } = {
    binance: {},
    bybit: {},
};

// Error counters
const errorCounts: { [exchange: string]: { [accountId: string]: number } } = {
    binance: {},
    bybit: {},
};

// Maximum consecutive errors before backing off
const MAX_CONSECUTIVE_ERRORS = 5;
// Initial backoff time in ms (1 minute)
const INITIAL_BACKOFF = 60000;
// Backoff times for each exchange and account
const backoffTimes: { [exchange: string]: { [accountId: string]: number } } = {
    binance: {},
    bybit: {},
};

// Set up WebSocket event handlers
// wsService.on('binance:accountUpdate', (data) => {
//     const accountId = data.accountType === 'futures' ? 'futures' : 'portfolioMargin';
//     if (cachedData.exchanges.binance[accountId]) {
//         // Update positions and balances
//         const currentData = cachedData.exchanges.binance[accountId];
//         currentData.positions = data.positions;
//         currentData.accountSummary.baseBalance = data.balances.find((b: any) => b.a === 'USDT')?.wb || 0;
//         lastFetchTimes.binance[accountId] = Date.now();
//     }
// });

// wsService.on('binance:orderUpdate', (data) => {
//     const accountId = data.accountType === 'futures' ? 'futures' : 'portfolioMargin';
//     if (cachedData.exchanges.binance[accountId]) {
//         // Update order information
//         const currentData = cachedData.exchanges.binance[accountId];
//         // Update orders based on the received data
//         lastFetchTimes.binance[accountId] = Date.now();
//     }
// });

// wsService.on('bybit:positionUpdate', (data) => {
//     if (cachedData.exchanges.bybit['unified']) {
//         // Update positions
//         const currentData = cachedData.exchanges.bybit['unified'];
//         currentData.positions = data.positions;
//         lastFetchTimes.bybit['unified'] = Date.now();
//     }
// });

// wsService.on('bybit:orderUpdate', (data) => {
//     if (cachedData.exchanges.bybit['unified']) {
//         // Update order information
//         const currentData = cachedData.exchanges.bybit['unified'];
//         // Update orders based on the received data
//         lastFetchTimes.bybit['unified'] = Date.now();
//     }
// });

// Initialize exchange clients
export async function initializeExchangeClients(): Promise<void> {
    try {
        // Initialize Binance Futures client
        const binanceFuturesClient = new BinanceClient(BinanceAccountType.FUTURES);
        await binanceFuturesClient.initialize();
        exchangeClients.binance['futures'] = binanceFuturesClient;

        // Initialize Binance Portfolio Margin client
        const binancePMClient = new BinanceClient(BinanceAccountType.PORTFOLIO_MARGIN);
        await binancePMClient.initialize();
        exchangeClients.binance['portfolioMargin'] = binancePMClient;

        // Initialize Bybit Unified client
        const bybitClient = new BybitClient();
        await bybitClient.initialize();
        exchangeClients.bybit['unified'] = bybitClient;

        console.log('All exchange clients initialized successfully');
    } catch (error) {
        console.error('Error initializing exchange clients:', error);
        throw error;
    }
}

function logAccountMetrics(data: CombinedData) {
    console.log('\n========== ACCOUNT METRICS ==========');

    // Log metrics for each exchange and account
    for (const exchange of Object.keys(data.exchanges)) {
        console.log(`\n=== ${exchange.toUpperCase()} ===`);

        for (const accountId of Object.keys(data.exchanges[exchange])) {
            const accountData = data.exchanges[exchange][accountId];
            if (!accountData) continue;

            console.log(`\n--- ${accountId} Account ---`);

            // Log Account Summary
            const summary = accountData.accountSummary;
            console.log('\nAccount Summary:');
            console.log(`• Base Currency: ${summary.baseCurrency}`);
            console.log(`• Base Balance: ${Number(summary.baseBalance).toFixed(2)} ${summary.baseCurrency}`);
            console.log(`• Total Notional Value: ${Number(summary.totalNotionalValue).toFixed(2)} ${summary.baseCurrency}`);
            console.log(`• Account Leverage: ${Number(summary.accountLeverage).toFixed(2)}x`);
            console.log(`• Open Positions: ${summary.openPositionsCount}`);
            console.log(`• Open Orders: ${summary.openOrdersCount}`);
            console.log(`• Margin Ratio: ${Number(summary.accountMarginRatio).toFixed(2)}%`);
            console.log(`• Liquidation Buffer: ${Number(summary.liquidationBuffer).toFixed(2)}%`);

            // Log Positions
            if (accountData.positions.length > 0) {
                console.log('\nOpen Positions:');
                accountData.positions.forEach((pos, index) => {
                    console.log(`\nPosition ${index + 1}:`);
                    console.log(`• Symbol: ${pos.symbol}`);
                    console.log(`• Side: ${pos.side}`);
                    console.log(`• Size: ${Number(pos.size).toFixed(2)}`);
                    console.log(`• Notional Value: ${Number(pos.notionalValue).toFixed(2)} ${summary.baseCurrency}`);
                    console.log(`• Entry Price: ${Number(pos.entryPrice).toFixed(2)}`);
                    console.log(`• Mark Price: ${Number(pos.markPrice).toFixed(2)}`);
                    console.log(`• Liquidation Price: ${Number(pos.liquidationPrice).toFixed(2)}`);
                    console.log(`• Liquidation change Percent: ${Number(pos.liquidationPriceChangePercent).toFixed(2)}%`);
                    console.log(`• Current Funding Rate: ${Number(pos.currentFundingRate).toFixed(2)}%`);
                    console.log(`• Next Funding Rate: ${Number(pos.nextFundingRate).toFixed(2)}%`);
                    console.log(`• Leverage: ${Number(pos.leverage).toFixed(2)}x`);
                    console.log(`• Unrealized PnL: ${Number(pos.unrealizedPnl).toFixed(2)} ${summary.baseCurrency}`);
                    console.log(`• Realized PnL: ${Number(pos.realizedPnl).toFixed(2)} ${summary.baseCurrency}`);
                    console.log(`• Margin Mode: ${pos.marginMode}`);
                });
            } else {
                console.log('\nNo open positions');
            }
        }
    }
    console.log('\n=====================================');
}

// Fetch data for a specific exchange and account
async function fetchExchangeData(exchange: string, accountId: string): Promise<void> {
    const client = exchangeClients[exchange][accountId];
    if (!client) {
        console.error(`No client found for ${exchange}/${accountId}`);
        return;
    }

    // Check if we're in backoff mode
    if (backoffTimes[exchange][accountId] > Date.now()) {
        console.log(`Skipping ${exchange}/${accountId} fetch due to backoff. Next attempt in ${Math.round((backoffTimes[exchange][accountId] - Date.now()) / 1000)}s`);
        return;
    }

    try {
        console.log(`\nFetching data from ${exchange} for account ${accountId}...`);
        const data = await client.getExchangeData();

        // Update cache
        cachedData.exchanges[exchange][accountId] = data;
        lastFetchTimes[exchange][accountId] = Date.now();

        // Reset error count on success
        errorCounts[exchange][accountId] = 0;
        backoffTimes[exchange][accountId] = 0;
    } catch (error) {
        console.error(`Error fetching ${exchange} data for account ${accountId}: ${error}`);

        // Initialize error tracking if needed
        if (!errorCounts[exchange][accountId]) {
            errorCounts[exchange][accountId] = 0;
        }

        // Increment error count
        errorCounts[exchange][accountId]++;

        // If we've had too many consecutive errors, back off
        if (errorCounts[exchange][accountId] >= MAX_CONSECUTIVE_ERRORS) {
            const backoffTime = INITIAL_BACKOFF * Math.pow(2, Math.min(errorCounts[exchange][accountId] - MAX_CONSECUTIVE_ERRORS, 5));
            backoffTimes[exchange][accountId] = Date.now() + backoffTime;
            console.log(`Too many consecutive ${exchange} errors for account ${accountId}. Backing off for ${backoffTime / 1000}s`);
        }
    }
}

// Start the data fetching service
export async function startDataFetcher(): Promise<void> {
    // Initialize all exchange clients
    await initializeExchangeClients();

    // Initial data fetch
    for (const exchange of Object.keys(exchangeClients)) {
        for (const accountId of Object.keys(exchangeClients[exchange])) {
            await fetchExchangeData(exchange, accountId);
        }
    }

    // Log initial metrics
    logAccountMetrics(cachedData);

    // Connect WebSocket for real-time updates
    // await wsService.connect();

    // Set up periodic metrics logging
    setInterval(() => {
        logAccountMetrics(cachedData);
    }, 60000); // Log metrics every minute
}

// Stop the data fetching service
// export function stopDataFetcher(): void {
//     wsService.close();
// }

// Get the current cached data
export function getCachedData(): CombinedData {
    return cachedData;
}

// Set current exchange and account
export function setCurrentExchangeAndAccount(exchange: string, account: string): void {
    if (cachedData.availableExchanges.includes(exchange) &&
        cachedData.availableAccounts[exchange].includes(account)) {
        cachedData.currentExchange = exchange;
        cachedData.currentAccount = account;
    } else {
        throw new Error(`Invalid exchange or account: ${exchange}/${account}`);
    }
}

// Get health status
export function getHealthStatus(): { [key: string]: any } {
    const now = Date.now();
    const status: { [key: string]: any } = {};

    for (const exchange of Object.keys(exchangeClients)) {
        status[exchange] = {};
        for (const accountId of Object.keys(exchangeClients[exchange])) {
            const lastFetch = lastFetchTimes[exchange][accountId] || 0;
            const timeSinceLastFetch = now - lastFetch;
            const isHealthy = lastFetch > 0 && timeSinceLastFetch < 300000; // 5 minutes
            const inBackoff = backoffTimes[exchange][accountId] > now;

            status[exchange][accountId] = {
                healthy: isHealthy,
                lastFetch: lastFetch ? new Date(lastFetch).toISOString() : null,
                timeSinceLastFetch: lastFetch ? Math.round(timeSinceLastFetch / 1000) : null,
                inBackoff,
                backoffEnds: inBackoff ? new Date(backoffTimes[exchange][accountId]).toISOString() : null,
                errorCount: errorCounts[exchange][accountId] || 0
            };
        }
    }

    return status;
}
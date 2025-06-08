export interface Position {
    symbol: string;
    side: 'LONG' | 'SHORT';
    size: number;
    notionalValue: number;
    entryPrice: number;
    markPrice: number;
    liquidationPrice: number;
    liquidationPriceChangePercent: number;
    currentFundingRate: number;
    nextFundingRate: number;
    leverage: number;
    unrealizedPnl: number;
    realizedPnl: number;
    marginMode: 'CROSS' | 'ISOLATED';
    exchange: string;
}

export interface AccountSummary {
    exchange: string;
    accountId: string;
    baseCurrency: string;
    baseBalance: number;
    totalNotionalValue: number;
    accountLeverage: number;
    openPositionsCount: number;
    openOrdersCount: number;
    liquidationBuffer: number;
    accountMarginRatio: number;
}

export interface ExchangeData {
    positions: Position[];
    accountSummary: AccountSummary;
}

export interface CombinedData {
    exchanges: {
        [exchangeName: string]: {
            [accountId: string]: ExchangeData;
        };
    };
    currentExchange: string;
    currentAccount: string;
    availableExchanges: string[];
    availableAccounts: { [exchange: string]: string[] };
}
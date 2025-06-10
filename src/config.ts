// export const config = {
//     port: process.env.PORT || 8080,
//     exchanges: {
//         binance: {
//             futures: {
//                 // Binance 1 (Normal Futures Account)
//                 apiKey: process.env.BINANCE_FUTURES_API_KEY || 'wQBWQeaYKxDt181bGFPFZAH7U2UXKigVVvBlmKGfsrq5k89BjCG0H6zKIjQ2dRPJ',
//                 apiSecret: process.env.BINANCE_FUTURES_API_SECRET || 'I3dDrmLtiRq7YK7bzobRa3QoTOd8Wmh0zGmu9pIyQOKRVR7Mgjgjk3e8GGcqgQbS',
//                 baseUrl: 'https://api.binance.com'
//             },
//             portfolioMargin: {
//                 // Binance 2 (Portfolio Margin Account - USDM+CoinM futures)
//                 apiKey: process.env.BINANCE_PM_API_KEY || 'aQIIhOsPnW0SQaVklY7J7jxNDxYkXWjfXiEUbUFA0ORSHkLm3mbJTEEPlftVKsVk',
//                 apiSecret: process.env.BINANCE_PM_API_SECRET || 'y4WAEBBA3VMYOa3qeAkNUqOMqUr8MyEnhSfT2ZNhUXaGwkj1TSERlTfuHG96aY4J',
//                 baseUrl: 'https://api.binance.com'
//             }
//         },
//         bybit: {
//             // Bybit 1 (Unified Margin + Futures)
//             apiKey: process.env.BYBIT_API_KEY || 'gkdkqHsxgQ6t1gj5PV',
//             apiSecret: process.env.BYBIT_API_SECRET || 'jidIU3oOLYZltaga06F6wD20t07h9jwOxjrV',
//             baseUrl: process.env.BYBIT_BASE_URL || 'https://api.bybit.com'
//         }
//     }
// };


export const config = {
    port: 8080,
    exchanges: {
        binance: {
            futures: {
                // Binance 1 (Normal Futures Account)
                apiKey: 'wQBWQeaYKxDt181bGFPFZAH7U2UXKigVVvBlmKGfsrq5k89BjCG0H6zKIjQ2dRPJ',
                apiSecret: 'I3dDrmLtiRq7YK7bzobRa3QoTOd8Wmh0zGmu9pIyQOKRVR7Mgjgjk3e8GGcqgQbS',
                baseUrl: 'https://api.binance.com'
            },
            portfolioMargin: {
                // Binance 2 (Portfolio Margin Account - USDM+CoinM futures)
                apiKey: 'aQIIhOsPnW0SQaVklY7J7jxNDxYkXWjfXiEUbUFA0ORSHkLm3mbJTEEPlftVKsVk',
                apiSecret: 'y4WAEBBA3VMYOa3qeAkNUqOMqUr8MyEnhSfT2ZNhUXaGwkj1TSERlTfuHG96aY4J',
                baseUrl: 'https://api.binance.com'
            }
        },
        bybit: {
            // // Bybit 1 (Unified Margin + Futures)
            apiKey: process.env.BYBIT_API_KEY || 'gkdkqHsxgQ6t1gj5PV',
            apiSecret: process.env.BYBIT_API_SECRET || 'jidIU3oOLYZltaga06F6wD20t07h9jwOxjrV',
            baseUrl: process.env.BYBIT_BASE_URL || 'https://api.bybit.com'
        }
    }
};

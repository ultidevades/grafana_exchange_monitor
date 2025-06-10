import express, { Request, Response, RequestHandler } from 'express';
import path from 'path';
import { getCachedData, setCurrentExchangeAndAccount, getHealthStatus } from '../services/dataFetcherService';
import { BinanceClient } from '../exchanges/binance.client';
import { BybitClient } from '../exchanges/bybit.client';
import { BinanceAccountType } from '../exchanges/binance.client';

const router = express.Router();

// Error handler wrapper
const asyncHandler = (fn: RequestHandler): RequestHandler => 
    (req: Request, res: Response, next: express.NextFunction) => {
        Promise.resolve(fn(req, res, next)).catch(error => {
            console.error(`Error in ${req.path}: ${error}`);
            res.status(500).json({ error: `Failed to process request: ${error.message}` });
        });
    };

// Root endpoint for API
router.get('/', ((req: Request, res: Response) => {
    res.json({
        status: 'ok',
        endpoints: {
            search: '/search',
            query: '/query',
            annotations: '/annotations',
            health: '/health'
        }
    });
}) as RequestHandler);

// Serve static files
router.use('/test', express.static(path.join(__dirname, '../public')));

// Grafana JSON API endpoints
router.get('/search', ((req: Request, res: Response) => {
    const metrics = [
        'positions',
        'account_summary',
        'available_exchanges',
        'health_status'
    ];
    res.json(metrics);
}) as RequestHandler);

router.post('/query', ((req: Request, res: Response) => {
    const { targets } = req.body;
    if (!targets || !Array.isArray(targets)) {
        return res.status(400).json({ error: 'Invalid request format' });
    }

    const data = getCachedData();
    const results = targets.map((target: any) => {
        if (target.target === 'positions') {
            const exchange = target.exchange || data.currentExchange;
            const account = target.account || data.currentAccount;
            const positions = data.exchanges[exchange]?.[account]?.positions || [];

            return {
                columns: [
                    { text: 'symbol' },
                    { text: 'side' },
                    { text: 'size' },
                    { text: 'notionalValue' },
                    { text: 'entryPrice' },
                    { text: 'markPrice' },
                    { text: 'liquidationPrice' },
                    { text: 'liquidationPriceChangePercent' },
                    { text: 'currentFundingRate' },
                    { text: 'nextFundingRate' },
                    { text: 'leverage' },
                    { text: 'unrealizedPnl' },
                    { text: 'realizedPnl' },
                    { text: 'marginMode' }
                ],
                rows: positions.map(pos => [
                    pos.symbol,
                    pos.side,
                    pos.size,
                    pos.notionalValue,
                    pos.entryPrice,
                    pos.markPrice,
                    pos.liquidationPrice,
                    pos.liquidationPriceChangePercent,
                    pos.currentFundingRate,
                    pos.nextFundingRate,
                    pos.leverage,
                    pos.unrealizedPnl,
                    pos.realizedPnl,
                    pos.marginMode
                ]),
                type: 'table'
            };
        }
        return null;
    }).filter(Boolean);

    res.json(results);
}) as RequestHandler);

// Get all data
router.get('/data', ((req: Request, res: Response) => {
    const data = getCachedData();
    res.json(data);
}) as RequestHandler);

// Get positions for current exchange and account
router.get('/positions', ((req: Request, res: Response) => {
    const data = getCachedData();
    const { currentExchange, currentAccount } = data;

    if (!currentExchange || !currentAccount) {
        return res.status(404).json({ error: 'No exchange or account selected' });
    }

    const exchangeData = data.exchanges[currentExchange]?.[currentAccount];
    if (!exchangeData) {
        return res.status(404).json({ error: 'No data available for selected exchange and account' });
    }

    res.json(exchangeData.positions);
}) as RequestHandler);

// Get account summary for current exchange and account
router.get('/account-summary', ((req: Request, res: Response) => {
    const data = getCachedData();
    const { currentExchange, currentAccount } = data;

    if (!currentExchange || !currentAccount) {
        return res.status(404).json({ error: 'No exchange or account selected' });
    }

    const exchangeData = data.exchanges[currentExchange]?.[currentAccount];
    if (!exchangeData) {
        return res.status(404).json({ error: 'No data available for selected exchange and account' });
    }

    res.json(exchangeData.accountSummary);
}) as RequestHandler);

// Get available exchanges and accounts
router.get('/available', ((req: Request, res: Response) => {
    const data = getCachedData();
    res.json({
        exchanges: data.availableExchanges,
        accounts: data.availableAccounts,
        currentExchange: data.currentExchange,
        currentAccount: data.currentAccount,
    });
}) as RequestHandler);

// Set current exchange and account
router.post('/set-current', ((req: Request, res: Response) => {
    const { exchange, account } = req.body;

    if (!exchange || !account) {
        return res.status(400).json({ error: 'Exchange and account are required' });
    }

    setCurrentExchangeAndAccount(exchange, account);
    res.json({ success: true, exchange, account });
}) as RequestHandler);

// Get health status
router.get('/health', ((req: Request, res: Response) => {
    const status = getHealthStatus();
    res.json(status);
}) as RequestHandler);

// Add API key for an exchange
router.post('/add-api-key', ((req: Request, res: Response) => {
    const { exchange, apiKey, apiSecret, accountName } = req.body;

    if (!exchange || !apiKey || !apiSecret || !accountName) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    if (exchange === 'binance') {
        const accountType = accountName === 'portfolioMargin' ?
            BinanceAccountType.PORTFOLIO_MARGIN : BinanceAccountType.FUTURES;
        const binanceClient = new BinanceClient(accountType);
        binanceClient.initialize()
            .then(() => {
                res.json({ success: true, message: 'API key added successfully' });
            })
            .catch(error => {
                res.status(500).json({ error: `Failed to initialize Binance client: ${error.message}` });
            });
    } else if (exchange === 'bybit') {
        const bybitClient = new BybitClient();
        bybitClient.initialize()
            .then(() => {
                res.json({ success: true, message: 'API key added successfully' });
            })
            .catch(error => {
                res.status(500).json({ error: `Failed to initialize Bybit client: ${error.message}` });
            });
    } else {
        res.status(400).json({ error: 'Unsupported exchange' });
    }
}) as RequestHandler);

// Get available accounts for an exchange
router.get('/accounts/:exchange', ((req: Request, res: Response) => {
    const { exchange } = req.params;
    const data = getCachedData();

    if (!data.availableAccounts[exchange]) {
        return res.status(404).json({ error: 'Exchange not found' });
    }

    res.json({
        accounts: data.availableAccounts[exchange],
        currentAccount: data.currentAccount
    });
}) as RequestHandler);

export const exchangeRoutes = router;
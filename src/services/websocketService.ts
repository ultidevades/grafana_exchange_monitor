import WebSocket from 'ws';
import { config } from '../config';
import { Position, AccountSummary, ExchangeData } from '../models/position.model';
import { EventEmitter } from 'events';

interface BinanceWebSocketMessage {
    e: string;
    E: number;
    [key: string]: any;
}

interface BybitWebSocketMessage {
    topic: string;
    data: any;
    [key: string]: any;
}

interface BybitWebSocketResponse {
    success: boolean;
    ret_msg: string;
    op: string;
    conn_id: string;
}

interface BinanceListenKeyResponse {
    listenKey: string;
}

export class WebSocketService extends EventEmitter {
    private binanceWs: WebSocket | null = null;
    private bybitWs: WebSocket | null = null;
    private binanceListenKey: string | null = null;
    private reconnectAttempts: { [key: string]: number } = {
        binance: 0,
        bybit: 0
    };
    private readonly MAX_RECONNECT_ATTEMPTS = 5;
    private readonly RECONNECT_DELAY = 5000; // 5 seconds

    constructor() {
        super();
    }

    public async connect(): Promise<void> {
        await this.initializeWebSockets();
    }

    private async initializeWebSockets() {
        await this.initializeBinanceWebSocket();
        await this.initializeBybitWebSocket();
    }

    private async initializeBinanceWebSocket() {
        try {
            console.log('\n====== Binance WebSocket Initialization ======');
            console.log('Starting WebSocket initialization...');
            // Get listen key for user data stream
            console.log('Requesting listen key from Binance...');
            const response = await fetch(`${config.exchanges.binance.futures.baseUrl}/fapi/v1/listenKey`, {
                method: 'POST',
                headers: {
                    'X-MBX-APIKEY': config.exchanges.binance.futures.apiKey
                }
            });
            const data = await response.json() as BinanceListenKeyResponse;
            this.binanceListenKey = data.listenKey;

            // Initialize WebSocket connection
            this.binanceWs = new WebSocket(`wss://fstream.binance.com/ws/${this.binanceListenKey}`);

            this.binanceWs.on('open', async () => {
                console.log('\n====== Binance Connection Status ======');
                console.log('WebSocket connected successfully');
                console.log('Connection ID:', this.binanceListenKey);
                this.reconnectAttempts.binance = 0;
                // Wait a short moment to ensure connection is stable
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log('WebSocket ready for data streaming');
            });

            this.binanceWs.on('message', (data: WebSocket.Data) => {
                this.handleBinanceMessage(data);
            });

            this.binanceWs.on('close', () => {
                console.log('\n====== Binance Connection Status ======');
                console.log('WebSocket disconnected');
                console.log('Last Listen Key:', this.binanceListenKey);
                this.handleReconnect('binance');
            });

            this.binanceWs.on('error', (error: Error) => {
                console.error('\n====== Binance Error ======');
                console.error('WebSocket error:', error);
                console.error('Current Listen Key:', this.binanceListenKey);
                this.handleReconnect('binance');
            });

            // Keep-alive for listen key
            setInterval(async () => {
                if (this.binanceListenKey) {
                    try {
                        await fetch(`${config.exchanges.binance.futures.baseUrl}/fapi/v1/listenKey`, {
                            method: 'PUT',
                            headers: {
                                'X-MBX-APIKEY': config.exchanges.binance.futures.apiKey
                            }
                        });
                        console.log('\n====== Binance Keep-Alive ======');
                        console.log('Listen key refreshed successfully');
                        console.log('Current Listen Key:', this.binanceListenKey);
                    } catch (error) {
                        console.error('\n====== Binance Keep-Alive Error ======');
                        console.error('Error refreshing listen key:', error);
                        console.error('Current Listen Key:', this.binanceListenKey);
                        this.handleReconnect('binance');
                    }
                }
            }, 30 * 60 * 1000); // Every 30 minutes
        } catch (error) {
            console.error('\n====== Binance Initialization Error ======');
            console.error('Error initializing WebSocket:', error);
            console.error('API Key:', config.exchanges.binance.futures.apiKey);
            this.handleReconnect('binance');
        }
    }

    private async initializeBybitWebSocket() {
        try {
            console.log('Initializing Bybit WebSocket connection...');
            // Initialize WebSocket connection
            this.bybitWs = new WebSocket('wss://stream.bybit.com/v5/private');

            this.bybitWs.on('open', async () => {
                console.log('Bybit WebSocket connected');
                this.reconnectAttempts.bybit = 0;
                // Wait a short moment to ensure connection is stable
                await new Promise(resolve => setTimeout(resolve, 1000));
                await this.authenticateBybitWebSocket();
            });

            this.bybitWs.on('message', (data: WebSocket.Data) => {
                this.handleBybitMessage(data);
            });

            this.bybitWs.on('close', () => {
                console.log('Bybit WebSocket disconnected');
                this.handleReconnect('bybit');
            });

            this.bybitWs.on('error', (error: Error) => {
                console.error('Bybit WebSocket error:', error);
            });
        } catch (error) {
            console.error('Error initializing Bybit WebSocket:', error);
            this.handleReconnect('bybit');
        }
    }

    private getExpires(): number {
        return Date.now() + 5000; // current time + 5 seconds in ms
    }

    private generateBybitSignature(expires: number): string {
        const crypto = require('crypto');
        const message = `GET/realtime${expires}`;
        return crypto
            .createHmac('sha256', config.exchanges.bybit.apiSecret)
            .update(message)
            .digest('hex');
    }

    private async authenticateBybitWebSocket() {
        if (!this.bybitWs || this.bybitWs.readyState !== WebSocket.OPEN) {
            console.log('WebSocket not ready for authentication');
            return;
        }

        try {
            console.log('\n====== Bybit Authentication ======');
            console.log('Starting WebSocket authentication...');

            const expires = this.getExpires();
            const signature = this.generateBybitSignature(expires);

            // Updated authentication message format to match official Bybit format
            const authMessage = {
                op: 'auth',
                args: [
                    config.exchanges.bybit.apiKey,
                    expires,
                    signature
                ]
            };

            console.log('Sending authentication request...');
            this.bybitWs.send(JSON.stringify(authMessage));

            // Wait for authentication response with timeout
            const response = await Promise.race([
                new Promise<BybitWebSocketResponse>((resolve) => {
                    const messageHandler = (data: WebSocket.Data) => {
                        try {
                            const response = JSON.parse(data.toString()) as BybitWebSocketResponse;
                            if (response.op === 'auth') {
                                this.bybitWs?.removeListener('message', messageHandler);
                                resolve(response);
                            }
                        } catch (error) {
                            console.error('Error parsing authentication response:', error);
                        }
                    };
                    this.bybitWs?.on('message', messageHandler);
                }),
                new Promise<BybitWebSocketResponse>((_, reject) =>
                    setTimeout(() => reject(new Error('Authentication timeout')), 5000)
                )
            ]);

            console.log('Authentication response received:', response);

            if (response.success) {
                console.log('Bybit WebSocket authentication successful');

                // Subscribe to relevant topics after successful authentication
                const subscribeMessage = {
                    op: 'subscribe',
                    args: [
                        'positions',
                        'orders',
                        'wallet'
                    ]
                };

                console.log('Subscribing to Bybit topics:', subscribeMessage.args);
                this.bybitWs?.send(JSON.stringify(subscribeMessage));

                // Reset reconnect attempts on successful authentication
                this.reconnectAttempts.bybit = 0;
            } else {
                throw new Error(`Authentication failed: ${response.ret_msg}`);
            }
        } catch (error) {
            console.error('\n====== Bybit Authentication Error ======');
            console.error('Error during authentication:', error);
            console.error('Authentication parameters:', {
                apiKey: config.exchanges.bybit.apiKey,
                expires: this.getExpires(),
                signature: this.generateBybitSignature(this.getExpires())
            });

            // Attempt to reconnect after authentication failure
            this.handleReconnect('bybit');
        }
    }

    private handleBinanceMessage(data: WebSocket.Data) {
        try {
            console.log('\n====== Binance Raw Message ======');
            console.log('Received raw data:', data.toString());

            const message = JSON.parse(data.toString()) as BinanceWebSocketMessage;
            console.log('\n====== Binance WebSocket Message ======');
            console.log('Event Type:', message.e);
            console.log('Event Time:', new Date(message.E).toLocaleString());
            console.log('Connection ID:', this.binanceListenKey);
            console.log('Message Data:', JSON.stringify(message, null, 2));

            // Handle different types of messages
            switch (message.e) {
                case 'ACCOUNT_UPDATE':
                    console.log('Account update received:', message.B?.length, 'positions updated');
                    this.handleBinanceAccountUpdate(message);
                    break;
                case 'ORDER_TRADE_UPDATE':
                    console.log('Order update received:', message.o?.s);
                    this.handleBinanceOrderUpdate(message);
                    break;
                case 'MARGIN_CALL':
                    console.log('Margin call received');
                    this.handleBinanceMarginCall(message);
                    break;
                default:
                    console.log('Unhandled message type:', message.e);
            }
        } catch (error) {
            console.error('\n====== Binance Message Error ======');
            console.error('Error handling message:', error);
            console.error('Raw message:', data.toString());
            console.error('Current Listen Key:', this.binanceListenKey);
        }
    }

    private handleBybitMessage(data: WebSocket.Data) {
        try {
            const rawMessage = data.toString();
            const message = JSON.parse(rawMessage);

            // Handle authentication response
            if (message.op === 'auth') {
                console.log('\n====== Bybit Authentication Response ======');
                console.log('Status:', message.success ? 'Success' : 'Failed');
                console.log('Connection ID:', message.conn_id);
                if (message.ret_msg) {
                    console.log('Message:', message.ret_msg);
                }
                return;
            }

            // Handle subscription response
            if (message.op === 'subscribe') {
                console.log('\n====== Bybit Subscription Response ======');
                console.log('Status:', message.success ? 'Success' : 'Failed');
                console.log('Connection ID:', message.conn_id);
                if (message.ret_msg) {
                    console.log('Message:', message.ret_msg);
                }
                return;
            }

            // Handle topic messages
            if (message.topic) {
                console.log('\n====== Bybit Topic Message ======');
                console.log('Topic:', message.topic);
                console.log('Type:', message.type);
                console.log('Data:', JSON.stringify(message.data, null, 2));

                // Handle different types of messages
                switch (message.topic) {
                    case 'positions':
                        console.log('Position update received:', message.data?.length, 'positions updated');
                        this.handleBybitPositionUpdate(message);
                        break;
                    case 'orders':
                        console.log('Order update received:', message.data?.length, 'orders updated');
                        this.handleBybitOrderUpdate(message);
                        break;
                    case 'wallet':
                        console.log('Wallet update received');
                        this.handleBybitWalletUpdate(message);
                        break;
                    default:
                        console.log('Unhandled topic:', message.topic);
                }
            } else {
                console.log('\n====== Bybit System Message ======');
                console.log('Message:', message);
            }
        } catch (error) {
            console.error('\n====== Bybit Message Error ======');
            console.error('Error handling message:', error);
            console.error('Raw message:', data.toString());
        }
    }

    private handleBinanceAccountUpdate(message: BinanceWebSocketMessage) {
        // Emit account update event
        this.emit('binance:accountUpdate', {
            positions: message.B || [],
            balances: message.b || []
        });
    }

    private handleBinanceOrderUpdate(message: BinanceWebSocketMessage) {
        // Emit order update event
        this.emit('binance:orderUpdate', {
            order: message.o
        });
    }

    private handleBinanceMarginCall(message: BinanceWebSocketMessage) {
        // Emit margin call event
        this.emit('binance:marginCall', {
            positions: message.p || []
        });
    }

    private handleBybitPositionUpdate(message: BybitWebSocketMessage) {
        // Emit position update event
        this.emit('bybit:positionUpdate', {
            positions: message.data || []
        });
    }

    private handleBybitOrderUpdate(message: BybitWebSocketMessage) {
        // Emit order update event
        this.emit('bybit:orderUpdate', {
            orders: message.data || []
        });
    }

    private handleBybitWalletUpdate(message: BybitWebSocketMessage) {
        // Emit wallet update event
        this.emit('bybit:walletUpdate', {
            wallet: message.data || {}
        });
    }

    private handleReconnect(exchange: 'binance' | 'bybit') {
        if (this.reconnectAttempts[exchange] >= this.MAX_RECONNECT_ATTEMPTS) {
            console.error(`Max reconnection attempts reached for ${exchange}`);
            return;
        }

        this.reconnectAttempts[exchange]++;
        console.log(`Attempting to reconnect ${exchange} WebSocket (attempt ${this.reconnectAttempts[exchange]})`);

        setTimeout(() => {
            if (exchange === 'binance') {
                this.initializeBinanceWebSocket();
            } else {
                this.initializeBybitWebSocket();
            }
        }, this.RECONNECT_DELAY);
    }

    public close() {
        if (this.binanceWs) {
            this.binanceWs.close();
        }
        if (this.bybitWs) {
            this.bybitWs.close();
        }
    }
} 
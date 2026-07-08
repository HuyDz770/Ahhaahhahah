/**
 * OMNICONTROL CORESHELL - GATEWAY BROKER SERVER
 * Deploy this on Railway (https://railway.app) to act as the intermediate proxy.
 *
 * Requirements: npm install express ws
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');

const app = express();
const port = process.env.PORT || 8080;

// Host the web panel statically
app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => {
    res.json({ status: 'healthy', android_connected: !!androidSocket, web_connected: webSockets.size });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Storage for active connections
let androidSocket = null;
const webSockets = new Set();

wss.on('connection', (ws, req) => {
    // Determine client type by query param (e.g., ws://.../?role=android)
    const urlParams = new URLSearchParams(req.url.split('?')[1]);
    const role = urlParams.get('role') || 'web';

    console.log(`[NETWORK] New client connected. Role: ${role}`);

    if (role === 'android') {
        if (androidSocket) {
            console.log("[NETWORK] Overwriting previous Android core connection.");
            androidSocket.close();
        }
        androidSocket = ws;
        broadcastToWeb({ type: 'SYSTEM_EVENT', message: 'Android Device agent connected.' });

        ws.on('message', (message) => {
            // Forward vitals / response data from Android to all connected Web clients
            try {
                const data = JSON.parse(message);
                broadcastToWeb(data);
            } catch (e) {
                // Raw transfer
                broadcastToWeb({ type: 'RAW_ANDROID_DATA', payload: message.toString() });
            }
        });

        ws.on('close', () => {
            console.log("[NETWORK] Android device disconnected.");
            androidSocket = null;
            broadcastToWeb({ type: 'SYSTEM_EVENT', message: 'Android Device agent disconnected.' });
        });

    } else {
        // Web Client role
        webSockets.add(ws);
        
        // Notify web client of active android state
        ws.send(JSON.stringify({
            type: 'SYSTEM_EVENT',
            message: `Connected to Broker. Android state: ${androidSocket ? 'ONLINE' : 'OFFLINE'}`
        }));

        ws.on('message', (message) => {
            // Forward control actions (TOUCH, HARDWARE_KEY, LAUNCH_APP) from Web to Android
            if (androidSocket && androidSocket.readyState === WebSocket.OPEN) {
                androidSocket.send(message.toString());
                console.log(`[RELAY] Forwarded command from Web to Android: ${message}`);
            } else {
                ws.send(JSON.stringify({
                    type: 'SYSTEM_ERROR',
                    message: 'Cannot forward action. Android device is offline.'
                }));
            }
        });

        ws.on('close', () => {
            console.log("[NETWORK] Web client disconnected.");
            webSockets.delete(ws);
        });
    }

    ws.on('error', (err) => {
        console.error(`[SOCKET ERROR] Client [${role}] error:`, err);
    });
});

// Helper to broadcast payloads to all web control screens
function broadcastToWeb(data) {
    const payload = JSON.stringify(data);
    for (const client of webSockets) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

server.listen(port, () => {
    console.log(`====================================================`);
    console.log(` OMNICONTROL BROKER STARTED SUCCESSFULLY`);
    console.log(` Port: ${port}`);
    console.log(` Web console static hosting ready.`);
    console.log(` API Endpoint: http://localhost:${port}/health`);
    console.log(`====================================================`);
});

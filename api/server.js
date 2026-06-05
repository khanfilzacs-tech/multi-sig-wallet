const express = require('express');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

const MULTISIG_ABI = [
    "function getOwners() view returns (address[])",
    "function required() view returns (uint256)",
    "function getTransactionCount() view returns (uint256)",
    "function getTransaction(uint256) view returns (address,uint256,bytes,bool,bool,uint256,uint256,address)",
    "function getBalance() view returns (uint256)",
    "function isReadyToExecute(uint256) view returns (bool)"
];

const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS;
const multisig = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, provider);

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: "MultiSig Wallet API",
        endpoints: {
            "/multisig/info": "Get wallet info",
            "/multisig/transactions": "Get all transactions",
            "/multisig/transaction/:id": "Get specific transaction",
            "/multisig/ready/:id": "Check if ready to execute"
        }
    });
});

app.get('/multisig/info', async (req, res) => {
    try {
        const owners = await multisig.getOwners();
        const required = await multisig.required();
        const balanceWei = await multisig.getBalance();
        const txCount = await multisig.getTransactionCount();
        
        res.json({
            success: true,
            address: MULTISIG_ADDRESS,
            owners,
            required: required.toString(),
            balance: ethers.formatEther(balanceWei),
            transactionCount: txCount.toString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/multisig/transactions', async (req, res) => {
    try {
        const txCount = await multisig.getTransactionCount();
        const transactions = [];
        
        for (let i = 0; i < txCount; i++) {
            const tx = await multisig.getTransaction(i);
            transactions.push({
                id: i,
                to: tx[0],
                value: ethers.formatEther(tx[1]),
                executed: tx[3],
                cancelled: tx[4],
                approvals: tx[5].toString(),
                proposedAt: new Date(parseInt(tx[6]) * 1000).toISOString(),
                proposer: tx[7]
            });
        }
        
        res.json({
            success: true,
            count: txCount.toString(),
            transactions
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/multisig/transaction/:id', async (req, res) => {
    try {
        const txId = parseInt(req.params.id);
        const tx = await multisig.getTransaction(txId);
        
        res.json({
            success: true,
            id: txId,
            to: tx[0],
            value: ethers.formatEther(tx[1]),
            executed: tx[3],
            cancelled: tx[4],
            approvals: tx[5].toString(),
            proposedAt: new Date(parseInt(tx[6]) * 1000).toISOString(),
            proposer: tx[7]
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/multisig/ready/:id', async (req, res) => {
    try {
        const txId = parseInt(req.params.id);
        const isReady = await multisig.isReadyToExecute(txId);
        
        res.json({
            success: true,
            transactionId: txId,
            isReadyToExecute: isReady
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ MultiSig API running on http://localhost:${PORT}`);
    console.log(`🔐 MultiSig Address: ${MULTISIG_ADDRESS}`);
});
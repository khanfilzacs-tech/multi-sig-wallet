const express = require('express');
const { ethers } = require('ethers');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);

// Submitter wallet: pays gas for proposals and relayed approvals
const submitterWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const MULTISIG_ABI = [
    "function getOwners() view returns (address[])",
    "function required() view returns (uint256)",
    "function getTransactionCount() view returns (uint256)",
    "function getTransaction(uint256) view returns (address,uint256,bytes,bool,bool,uint256,uint256,address)",
    "function getBalance() view returns (uint256)",
    "function isReadyToExecute(uint256) view returns (bool)",
    "function proposeTransaction(address,uint256,bytes) returns (uint256)",
    "function approveWithSignature(uint256,bytes)",
    "function execute(uint256)"
];

const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS;
const multisig = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, provider);
const multisigWriter = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, submitterWallet);

const APPROVAL_TYPES = {
    Approval: [{ name: "txId", type: "uint256" }]
};

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: "MultiSig Wallet API",
        endpoints: {
            "GET  /multisig/info": "Get wallet info",
            "GET  /multisig/transactions": "Get all transactions",
            "GET  /multisig/transaction/:id": "Get specific transaction",
            "GET  /multisig/ready/:id": "Check if ready to execute",
            "POST /multisig/propose": "Propose ETH transfer — body: { to, valueEth }",
            "POST /multisig/sign-approval": "Owner signs approval off-chain — body: { txId, ownerPrivateKey }",
            "POST /multisig/submit-approval": "Relay a signed approval (submitter pays gas) — body: { txId, signature }",
            "POST /multisig/execute": "Execute a ready transaction — body: { txId, executorPrivateKey }"
        }
    });
});

// ============================================================
// READ ENDPOINTS
// ============================================================

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

        res.json({ success: true, count: txCount.toString(), transactions });
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

        res.json({ success: true, transactionId: txId, isReadyToExecute: isReady });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================
// WRITE ENDPOINTS
// ============================================================

// Anyone can propose — submitter wallet pays gas
app.post('/multisig/propose', async (req, res) => {
    try {
        const { to, valueEth } = req.body;
        if (!to || !valueEth) return res.status(400).json({ success: false, error: "to and valueEth are required" });

        const value = ethers.parseEther(String(valueEth));
        const tx = await multisigWriter.proposeTransaction(to, value, "0x");
        await tx.wait();

        const txCount = await multisig.getTransactionCount();
        const txId = Number(txCount) - 1;

        res.json({ success: true, txId, txHash: tx.hash, gasPaidBy: submitterWallet.address });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Owner signs approval off-chain — returns signature, costs NO gas
// The private key never leaves the server in a real deployment; this endpoint is for demo/testing
app.post('/multisig/sign-approval', async (req, res) => {
    try {
        const { txId, ownerPrivateKey } = req.body;
        if (txId === undefined || !ownerPrivateKey) {
            return res.status(400).json({ success: false, error: "txId and ownerPrivateKey are required" });
        }

        const ownerWallet = new ethers.Wallet(ownerPrivateKey);
        const { chainId } = await provider.getNetwork();

        const domain = {
            name: "MultiSigWallet",
            version: "1",
            chainId,
            verifyingContract: MULTISIG_ADDRESS
        };

        const signature = await ownerWallet.signTypedData(domain, APPROVAL_TYPES, { txId });

        res.json({
            success: true,
            txId,
            owner: ownerWallet.address,
            signature,
            note: "Owner signed off-chain. No gas was used."
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Relay owner's signature on-chain — submitter pays gas, NOT the owner
app.post('/multisig/submit-approval', async (req, res) => {
    try {
        const { txId, signature } = req.body;
        if (txId === undefined || !signature) {
            return res.status(400).json({ success: false, error: "txId and signature are required" });
        }

        const tx = await multisigWriter.approveWithSignature(txId, signature);
        await tx.wait();

        res.json({
            success: true,
            txId,
            txHash: tx.hash,
            gasPaidBy: submitterWallet.address,
            note: "Approval relayed on-chain. Gas was paid by the submitter, not the owner."
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Execute a transaction — must be called by an owner
app.post('/multisig/execute', async (req, res) => {
    try {
        const { txId, executorPrivateKey } = req.body;
        if (txId === undefined || !executorPrivateKey) {
            return res.status(400).json({ success: false, error: "txId and executorPrivateKey are required" });
        }

        const executorWallet = new ethers.Wallet(executorPrivateKey, provider);
        const contract = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, executorWallet);
        const tx = await contract.execute(txId);
        await tx.wait();

        res.json({ success: true, txId, txHash: tx.hash, executor: executorWallet.address });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.listen(PORT, () => {
    console.log(`✅ MultiSig API running on http://localhost:${PORT}`);
    console.log(`🔐 MultiSig Address: ${MULTISIG_ADDRESS}`);
    console.log(`💳 Submitter (gas payer): ${submitterWallet.address}`);
});

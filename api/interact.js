const { ethers } = require("ethers");
require("dotenv").config();

// ============================================================
// CONFIGURATION
// ============================================================
const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// MultiSig ABI (working version from test.js)
const MULTISIG_ABI = [
    "function proposeTransaction(address,uint256,bytes) returns (uint256)",
    "function approve(uint256)",
    "function execute(uint256)",
    "function revokeApproval(uint256)",
    "function getTransactionCount() view returns (uint256)",
    "function getTransaction(uint256) view returns (address,uint256,bytes,bool,bool,uint256,uint256,address)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint256)",
    "function getBalance() view returns (uint256)",
    "function isReadyToExecute(uint256) view returns (bool)"
];

const multisig = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, wallet);

// ============================================================
// FUNCTIONS
// ============================================================

async function proposeEthTransfer(to, amount) {
    console.log(`\n📝 Proposing ETH transfer: ${amount} ETH to ${to}`);
    const value = ethers.parseEther(amount);
    const tx = await multisig.proposeTransaction(to, value, "0x");
    await tx.wait();
    const txCount = await multisig.getTransactionCount();
    console.log(`✅ Proposed! Transaction ID: ${txCount - 1}`);
    console.log(`📋 Tx Hash: ${tx.hash}`);
    return txCount - 1;
}

async function proposeTokenTransfer(token, to, amount) {
    console.log(`\n📝 Proposing Token transfer: ${amount} tokens to ${to}`);
    const decimals = 18;
    const amountWei = ethers.parseUnits(amount.toString(), decimals);
    
    const data = ethers.concat([
        "0xa9059cbb",
        ethers.zeroPadValue(to, 32),
        ethers.zeroPadValue(ethers.toBeHex(amountWei), 32)
    ]);
    
    const tx = await multisig.proposeTransaction(token, 0, data);
    await tx.wait();
    const txCount = await multisig.getTransactionCount();
    console.log(`✅ Proposed! Transaction ID: ${txCount - 1}`);
    console.log(`📋 Tx Hash: ${tx.hash}`);
    return txCount - 1;
}

async function approveTransaction(txId) {
    console.log(`\n✅ Approving transaction ${txId}...`);
    const tx = await multisig.approve(txId);
    await tx.wait();
    console.log(`✅ Approved! Tx Hash: ${tx.hash}`);
}

async function executeTransaction(txId) {
    console.log(`\n🚀 Executing transaction ${txId}...`);
    const tx = await multisig.execute(txId);
    await tx.wait();
    console.log(`✅ Executed! Tx Hash: ${tx.hash}`);
}

async function revokeApproval(txId) {
    console.log(`\n↩️ Revoking approval for transaction ${txId}...`);
    const tx = await multisig.revokeApproval(txId);
    await tx.wait();
    console.log(`✅ Revoked! Tx Hash: ${tx.hash}`);
}

async function getTransaction(txId) {
    const tx = await multisig.getTransaction(txId);
    console.log(`\n📋 Transaction ${txId}:`);
    console.log(`   To: ${tx[0]}`);
    console.log(`   Value: ${ethers.formatEther(tx[1])} ETH`);
    console.log(`   Data: ${tx[2].substring(0, 50)}...`);
    console.log(`   Executed: ${tx[3]}`);
    console.log(`   Cancelled: ${tx[4]}`);
    console.log(`   Approvals: ${tx[5].toString()}`);
    console.log(`   Proposer: ${tx[7]}`);
    return tx;
}

async function getAllTransactions() {
    const count = await multisig.getTransactionCount();
    console.log(`\n📊 Total Transactions: ${count}`);
    for (let i = 0; i < count; i++) {
        await getTransaction(i);
    }
}

async function getInfo() {
    const owners = await multisig.getOwners();
    const required = await multisig.required();
    const balance = await multisig.getBalance();
    const txCount = await multisig.getTransactionCount();
    
    console.log("\n🏛️ MULTISIG INFO");
    console.log("=".repeat(40));
    console.log(`Address: ${MULTISIG_ADDRESS}`);
    console.log(`Owners: ${owners.join(", ")}`);
    console.log(`Required Approvals: ${required}`);
    console.log(`Balance: ${ethers.formatEther(balance)} ETH`);
    console.log(`Total Transactions: ${txCount}`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    console.log("🔐 Connected with address:", wallet.address);
    console.log("🏛️ MultiSig Address:", MULTISIG_ADDRESS);
    
    // Uncomment jo karna hai:
    
    // Get MultiSig info
    await getInfo();
    
    // Propose ETH transfer
    // await proposeEthTransfer("0xd9BBF5Ce61063cd2D64756821b47a0c1a7059C9d", "0.001");
    
    // Approve transaction (Owner 2 ke saath run karo)
    // await approveTransaction(0);
    
    // Execute transaction (Owner 1 ke saath run karo)
    await executeTransaction(0);
    
    // Check all transactions
    await getAllTransactions();
}

main().catch(console.error);
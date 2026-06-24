const { ethers } = require("ethers");
require("dotenv").config();

// ============================================================
// CONFIGURATION
// ============================================================
const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS;
const RPC_URL = process.env.RPC_URL;

// The submitter is whoever proposes and relays signed approvals — they pay gas
const SUBMITTER_PRIVATE_KEY = process.env.PRIVATE_KEY;

// Owner private keys are used only for off-chain signing (no gas deducted)
const OWNER_PRIVATE_KEY_1 = process.env.OWNER_PRIVATE_KEY_1;
const OWNER_PRIVATE_KEY_2 = process.env.OWNER_PRIVATE_KEY_2;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const submitterWallet = new ethers.Wallet(SUBMITTER_PRIVATE_KEY, provider);

const MULTISIG_ABI = [
    "function proposeTransaction(address,uint256,bytes) returns (uint256)",
    "function approve(uint256)",
    "function approveWithSignature(uint256,bytes)",
    "function execute(uint256)",
    "function revokeApproval(uint256)",
    "function getTransactionCount() view returns (uint256)",
    "function getTransaction(uint256) view returns (address,uint256,bytes,bool,bool,uint256,uint256,address)",
    "function getOwners() view returns (address[])",
    "function required() view returns (uint256)",
    "function getBalance() view returns (uint256)",
    "function isReadyToExecute(uint256) view returns (bool)"
];

// Submitter-connected contract instance (pays gas for proposals and relayed approvals)
const multisig = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, submitterWallet);

// EIP-712 typed data definition — must match the contract exactly
const APPROVAL_TYPES = {
    Approval: [{ name: "txId", type: "uint256" }]
};

// ============================================================
// PROPOSAL FUNCTIONS  (anyone can call — submitter pays gas)
// ============================================================

async function proposeEthTransfer(to, amount) {
    console.log(`\n📝 Proposing ETH transfer: ${amount} ETH to ${to}`);
    console.log(`   Gas paid by: ${submitterWallet.address}`);
    const value = ethers.parseEther(amount);
    const tx = await multisig.proposeTransaction(to, value, "0x");
    await tx.wait();
    const txCount = await multisig.getTransactionCount();
    const txId = Number(txCount) - 1;
    console.log(`✅ Proposed! Transaction ID: ${txId}`);
    console.log(`📋 Tx Hash: ${tx.hash}`);
    return txId;
}

async function proposeTokenTransfer(token, to, amount) {
    console.log(`\n📝 Proposing Token transfer: ${amount} tokens to ${to}`);
    console.log(`   Gas paid by: ${submitterWallet.address}`);
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
    const txId = Number(txCount) - 1;
    console.log(`✅ Proposed! Transaction ID: ${txId}`);
    console.log(`📋 Tx Hash: ${tx.hash}`);
    return txId;
}

// ============================================================
// APPROVAL FUNCTIONS (EIP-712 meta-approval pattern)
// ============================================================

// Step 1: Owner signs the approval off-chain using their private key — ZERO gas cost
async function signApproval(txId, ownerPrivateKey) {
    const ownerWallet = new ethers.Wallet(ownerPrivateKey); // no provider needed for signing
    const { chainId } = await provider.getNetwork();

    const domain = {
        name: "MultiSigWallet",
        version: "1",
        chainId,
        verifyingContract: MULTISIG_ADDRESS
    };

    const signature = await ownerWallet.signTypedData(domain, APPROVAL_TYPES, { txId });

    console.log(`\n✍️  Owner ${ownerWallet.address} signed approval for tx #${txId}`);
    console.log(`   Signature: ${signature}`);
    return signature;
}

// Step 2: Submitter sends the owner's signature to the chain — submitter pays gas, NOT the owner
async function submitApproval(txId, signature) {
    console.log(`\n📤 Submitting signed approval for tx #${txId}...`);
    console.log(`   Gas paid by: ${submitterWallet.address}`);
    const tx = await multisig.approveWithSignature(txId, signature);
    await tx.wait();
    console.log(`✅ Approval recorded on-chain! Tx Hash: ${tx.hash}`);
}

// Convenience wrapper: owner signs and submitter relays in one call
async function approveAsOwner(txId, ownerPrivateKey) {
    const signature = await signApproval(txId, ownerPrivateKey);
    await submitApproval(txId, signature);
}

// Direct approve: owner pays their own gas (kept for backward compatibility)
async function approveDirectly(txId, ownerPrivateKey) {
    const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
    const contract = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, ownerWallet);
    console.log(`\n✅ Owner ${ownerWallet.address} approving tx #${txId} directly...`);
    const tx = await contract.approve(txId);
    await tx.wait();
    console.log(`✅ Approved! Tx Hash: ${tx.hash}`);
}

// ============================================================
// EXECUTION & REVOKE
// ============================================================

async function executeTransaction(txId, executorPrivateKey) {
    const executorWallet = executorPrivateKey
        ? new ethers.Wallet(executorPrivateKey, provider)
        : submitterWallet;
    const contract = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, executorWallet);
    console.log(`\n🚀 Executing transaction #${txId}...`);
    console.log(`   Executor: ${executorWallet.address}`);
    const tx = await contract.execute(txId);
    await tx.wait();
    console.log(`✅ Executed! Tx Hash: ${tx.hash}`);
}

async function revokeApproval(txId, ownerPrivateKey) {
    const ownerWallet = new ethers.Wallet(ownerPrivateKey, provider);
    const contract = new ethers.Contract(MULTISIG_ADDRESS, MULTISIG_ABI, ownerWallet);
    console.log(`\n↩️  Revoking approval for tx #${txId}...`);
    const tx = await contract.revokeApproval(txId);
    await tx.wait();
    console.log(`✅ Revoked! Tx Hash: ${tx.hash}`);
}

// ============================================================
// READ FUNCTIONS
// ============================================================

async function getTransaction(txId) {
    const tx = await multisig.getTransaction(txId);
    console.log(`\n📋 Transaction #${txId}:`);
    console.log(`   To:        ${tx[0]}`);
    console.log(`   Value:     ${ethers.formatEther(tx[1])} ETH`);
    console.log(`   Data:      ${tx[2].length > 10 ? tx[2].substring(0, 50) + "..." : tx[2]}`);
    console.log(`   Executed:  ${tx[3]}`);
    console.log(`   Cancelled: ${tx[4]}`);
    console.log(`   Approvals: ${tx[5].toString()}`);
    console.log(`   Proposed:  ${new Date(Number(tx[6]) * 1000).toISOString()}`);
    console.log(`   Proposer:  ${tx[7]}`);
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

    console.log("\n🏛️  MULTISIG INFO");
    console.log("=".repeat(40));
    console.log(`Address:            ${MULTISIG_ADDRESS}`);
    console.log(`Owners:             ${owners.join(", ")}`);
    console.log(`Required Approvals: ${required}`);
    console.log(`Balance:            ${ethers.formatEther(balance)} ETH`);
    console.log(`Total Transactions: ${txCount}`);
}

// ============================================================
// MAIN — demonstrates the full meta-approval flow
// ============================================================
async function main() {
    console.log("🔐 Submitter address:", submitterWallet.address);
    console.log("   (This wallet pays gas for proposals and approval relays)");
    console.log("🏛️  MultiSig Address:", MULTISIG_ADDRESS);

    await getInfo();

    // --- EXAMPLE FLOW (uncomment to use) ---

    // Step 1: Anyone proposes — submitter pays gas
    // const txId = await proposeEthTransfer("0xd9BBF5Ce61063cd2D64756821b47a0c1a7059C9d", "0.001");

    // Step 2: Owner 1 signs off-chain (no gas), submitter relays it (pays gas)
    // await approveAsOwner(txId, OWNER_PRIVATE_KEY_1);

    // Step 3: Owner 2 signs off-chain (no gas), submitter relays it (pays gas)
    // await approveAsOwner(txId, OWNER_PRIVATE_KEY_2);

    // Step 4: Execute (must be called by an owner)
    // await executeTransaction(txId, OWNER_PRIVATE_KEY_1);

    // --- OR: just get current state ---
    await getAllTransactions();
}

main().catch(console.error);

const { ethers } = require("ethers");
require("dotenv").config();

const MULTISIG_ADDRESS = process.env.MULTISIG_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const RPC_URL = process.env.RPC_URL;

const provider = new ethers.JsonRpcProvider(RPC_URL);
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

// Simple ABI just for testing
const SIMPLE_ABI = [
    "function proposeTransaction(address,uint256,bytes) returns (uint256)",
    "function getTransactionCount() view returns (uint256)"
];

const multisig = new ethers.Contract(MULTISIG_ADDRESS, SIMPLE_ABI, wallet);

async function test() {
    console.log("Testing proposeTransaction...");
    console.log("MultiSig Address:", MULTISIG_ADDRESS);
    console.log("Wallet:", wallet.address);
    
    try {
        const to = "0xd9BBF5Ce61063cd2D64756821b47a0c1a7059C9d";
        const value = ethers.parseEther("0.001");
        const data = "0x";
        
        console.log(`Calling proposeTransaction with:`);
        console.log(`  to: ${to}`);
        console.log(`  value: ${value.toString()}`);
        console.log(`  data: ${data}`);
        
        const tx = await multisig.proposeTransaction(to, value, data);
        console.log("Transaction sent! Waiting...");
        await tx.wait();
        console.log("✅ Success!");
        
        const count = await multisig.getTransactionCount();
        console.log(`Transaction count: ${count}`);
        
    } catch (error) {
        console.error("Error:", error.message);
        if (error.reason) console.log("Reason:", error.reason);
        if (error.data) console.log("Data:", error.data);
    }
}

test();

const { ethers } = require("ethers");
require("dotenv").config();

async function main() {
  const owner1 = new ethers.Wallet(process.env.OWNER1_PRIVATE_KEY);
  const owner2 = new ethers.Wallet(process.env.OWNER2_PRIVATE_KEY);

  const domain = {
    name: "MultiSigWallet",
    version: "1",
    chainId: 11155111,
    verifyingContract: process.env.MULTISIG_ADDRESS,
  };

  const types = {
    Approval: [{ name: "txId", type: "uint256" }],
  };

  const value = { txId: 0 };  // ← naya txId jo non-owner ne propose kiya

  const sig1 = await owner1.signTypedData(domain, types, value);
  const sig2 = await owner2.signTypedData(domain, types, value);

  console.log("Owner1 address:", owner1.address);
  console.log("Owner1 signature:", sig1);
  console.log("---");
  console.log("Owner2 address:", owner2.address);
  console.log("Owner2 signature:", sig2);
}

main();
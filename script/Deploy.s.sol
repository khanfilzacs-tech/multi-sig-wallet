// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/MultiSigWallet.sol";

contract DeployMultiSig is Script {

    address[] owners;
    uint256 constant REQUIRED  = 2;
    uint256 constant TX_EXPIRY = 7 days;

    function setUp() public {
        owners.push(0xb356a4D3235e961933DFDBDE264ab657B6961F58);
        owners.push(0xd9BBF5Ce61063cd2D64756821b47a0c1a7059C9d);
        owners.push(0x212568b81A52c67e2Fdc8d799dA96Ee1C7c103Fc);
    }

    function run() external returns (MultiSigWallet wallet) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        console.log("Deploying...");
        vm.startBroadcast(deployerKey);
        wallet = new MultiSigWallet(owners, REQUIRED, TX_EXPIRY);
        vm.stopBroadcast();
        console.log("Deployed at:", address(wallet));
    }
}
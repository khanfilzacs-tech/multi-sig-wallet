// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MultiSigWallet is ReentrancyGuard, EIP712 {

    event Deposit(address indexed sender, uint256 amount, uint256 balance);
    event TransactionProposed(uint256 indexed txId, address indexed proposer, address indexed to, uint256 value, bytes data);
    event TransactionApproved(uint256 indexed txId, address indexed owner);
    event ApprovalRevoked(uint256 indexed txId, address indexed owner);
    event TransactionExecuted(uint256 indexed txId, address indexed executor);
    event TransactionCancelled(uint256 indexed txId);
    event OwnerAdded(address indexed newOwner);
    event OwnerRemoved(address indexed removedOwner);
    event RequirementChanged(uint256 oldRequired, uint256 newRequired);

    bytes32 private constant APPROVAL_TYPEHASH = keccak256("Approval(uint256 txId)");

    struct Transaction {
        address to;
        uint256 value;
        bytes data;
        bool executed;
        bool cancelled;
        uint256 approvals;
        uint256 proposedAt;
        address proposer;
    }

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public required;
    uint256 public txExpiry;
    Transaction[] public transactions;
    mapping(uint256 => mapping(address => bool)) public approved;

    modifier onlyOwner() {
        require(isOwner[msg.sender], "MultiSig: Not an owner");
        _;
    }

    modifier onlyWallet() {
        require(msg.sender == address(this), "MultiSig: Only wallet itself");
        _;
    }

    modifier txExists(uint256 _txId) {
        require(_txId < transactions.length, "MultiSig: Transaction does not exist");
        _;
    }

    modifier notExecuted(uint256 _txId) {
        require(!transactions[_txId].executed, "MultiSig: Already executed");
        _;
    }

    modifier notCancelled(uint256 _txId) {
        require(!transactions[_txId].cancelled, "MultiSig: Transaction cancelled");
        _;
    }

    modifier notExpired(uint256 _txId) {
        require(block.timestamp <= transactions[_txId].proposedAt + txExpiry, "MultiSig: Transaction expired");
        _;
    }

    constructor(
        address[] memory _owners,
        uint256 _required,
        uint256 _txExpiry
    ) payable EIP712("MultiSigWallet", "1") {
        require(_owners.length >= 2, "MultiSig: Need at least 2 owners");
        require(_required >= 1 && _required <= _owners.length, "MultiSig: Invalid required count");
        require(_txExpiry >= 1 hours, "MultiSig: Expiry too short");

        for (uint256 i = 0; i < _owners.length; i++) {
            address owner = _owners[i];
            require(owner != address(0), "MultiSig: Zero address not allowed");
            require(!isOwner[owner], "MultiSig: Duplicate owner");
            isOwner[owner] = true;
            owners.push(owner);
        }

        required = _required;
        txExpiry = _txExpiry;
    }

    receive() external payable {
        emit Deposit(msg.sender, msg.value, address(this).balance);
    }

    // ============================================================
    // CORE FUNCTIONS
    // ============================================================

    // Anyone can propose a transaction — no owner restriction
    function proposeTransaction(
        address _to,
        uint256 _value,
        bytes memory _data
    ) public returns (uint256 txId) {
        require(_to != address(0), "MultiSig: Invalid recipient");
        txId = transactions.length;
        transactions.push(Transaction({
            to: _to,
            value: _value,
            data: _data,
            executed: false,
            cancelled: false,
            approvals: 0,
            proposedAt: block.timestamp,
            proposer: msg.sender
        }));
        emit TransactionProposed(txId, msg.sender, _to, _value, _data);
        // Auto-approve only if the proposer happens to be an owner
        if (isOwner[msg.sender]) {
            _approve(txId);
        }
    }

    // Direct approve: owner calls this themselves and pays their own gas
    function approve(uint256 _txId)
        external onlyOwner txExists(_txId) notExecuted(_txId) notCancelled(_txId) notExpired(_txId)
    {
        require(!approved[_txId][msg.sender], "MultiSig: Already approved");
        _approve(_txId);
    }

    // Meta-approval: owner signs off-chain, anyone can submit — submitter pays gas, not the owner
    function approveWithSignature(uint256 _txId, bytes memory _signature)
        external txExists(_txId) notExecuted(_txId) notCancelled(_txId) notExpired(_txId)
    {
        bytes32 structHash = keccak256(abi.encode(APPROVAL_TYPEHASH, _txId));
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, _signature);

        require(isOwner[signer], "MultiSig: Signer is not an owner");
        require(!approved[_txId][signer], "MultiSig: Already approved by this owner");

        approved[_txId][signer] = true;
        transactions[_txId].approvals += 1;
        emit TransactionApproved(_txId, signer);
    }

    function revokeApproval(uint256 _txId)
        external onlyOwner txExists(_txId) notExecuted(_txId) notCancelled(_txId)
    {
        require(approved[_txId][msg.sender], "MultiSig: Not approved yet");
        approved[_txId][msg.sender] = false;
        transactions[_txId].approvals -= 1;
        emit ApprovalRevoked(_txId, msg.sender);
    }

    function execute(uint256 _txId)
        external onlyOwner txExists(_txId) notExecuted(_txId) notCancelled(_txId) notExpired(_txId) nonReentrant
    {
        Transaction storage txn = transactions[_txId];
        require(txn.approvals >= required, "MultiSig: Not enough approvals");
        require(address(this).balance >= txn.value, "MultiSig: Insufficient ETH balance");
        txn.executed = true;
        (bool success, ) = txn.to.call{value: txn.value}(txn.data);
        require(success, "MultiSig: Transaction execution failed");
        emit TransactionExecuted(_txId, msg.sender);
    }

    function cancelTransaction(uint256 _txId)
        external txExists(_txId) notExecuted(_txId) notCancelled(_txId)
    {
        Transaction storage txn = transactions[_txId];
        require(msg.sender == txn.proposer || msg.sender == address(this), "MultiSig: Not authorized to cancel");
        txn.cancelled = true;
        emit TransactionCancelled(_txId);
    }

    function _approve(uint256 _txId) internal {
        approved[_txId][msg.sender] = true;
        transactions[_txId].approvals += 1;
        emit TransactionApproved(_txId, msg.sender);
    }

    // ============================================================
    // SIMPLE WRAPPER FUNCTIONS
    // ============================================================

    // Anyone can propose an ETH transfer
    function proposeEthTransfer(
        address _to,
        uint256 _value
    ) external returns (uint256 txId) {
        require(_to != address(0), "MultiSig: Invalid recipient");
        require(_value > 0, "MultiSig: Amount must be > 0");
        return proposeTransaction(_to, _value, "");
    }

    // Anyone can propose a token transfer
    function proposeTokenTransfer(
        address _token,
        address _to,
        uint256 _amount
    ) external returns (uint256 txId) {
        require(_token != address(0), "MultiSig: Invalid token address");
        require(_to != address(0), "MultiSig: Invalid recipient");
        require(_amount > 0, "MultiSig: Amount must be > 0");

        bytes memory data = abi.encodeWithSignature("transfer(address,uint256)", _to, _amount);
        return proposeTransaction(_token, 0, data);
    }

    // Anyone can propose a token approve
    function proposeTokenApprove(
        address _token,
        address _spender,
        uint256 _amount
    ) external returns (uint256 txId) {
        require(_token != address(0), "MultiSig: Invalid token address");
        require(_spender != address(0), "MultiSig: Invalid spender");

        bytes memory data = abi.encodeWithSignature("approve(address,uint256)", _spender, _amount);
        return proposeTransaction(_token, 0, data);
    }

    // ============================================================
    // OWNER MANAGEMENT
    // ============================================================

    function addOwner(address _newOwner) external onlyWallet {
        require(_newOwner != address(0), "MultiSig: Zero address");
        require(!isOwner[_newOwner], "MultiSig: Already an owner");
        isOwner[_newOwner] = true;
        owners.push(_newOwner);
        emit OwnerAdded(_newOwner);
    }

    function removeOwner(address _owner) external onlyWallet {
        require(isOwner[_owner], "MultiSig: Not an owner");
        require(owners.length - 1 >= required, "MultiSig: Would break quorum");
        isOwner[_owner] = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == _owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(_owner);
    }

    function changeRequirement(uint256 _newRequired) external onlyWallet {
        require(_newRequired >= 1 && _newRequired <= owners.length, "MultiSig: Invalid requirement");
        emit RequirementChanged(required, _newRequired);
        required = _newRequired;
    }

    // ============================================================
    // GETTER FUNCTIONS
    // ============================================================

    function getTransactionCount() external view returns (uint256) {
        return transactions.length;
    }

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function getTransaction(uint256 _txId)
        external view txExists(_txId)
        returns (address to, uint256 value, bytes memory data, bool executed, bool cancelled, uint256 approvalCount, uint256 proposedAt, address proposer)
    {
        Transaction storage txn = transactions[_txId];
        return (txn.to, txn.value, txn.data, txn.executed, txn.cancelled, txn.approvals, txn.proposedAt, txn.proposer);
    }

    function isReadyToExecute(uint256 _txId) external view txExists(_txId) returns (bool) {
        Transaction storage txn = transactions[_txId];
        return (!txn.executed && !txn.cancelled && txn.approvals >= required && block.timestamp <= txn.proposedAt + txExpiry);
    }

    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    // Returns the EIP-712 domain separator — useful for client-side signing
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}

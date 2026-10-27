// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Balance { function balanceOf(address) external view returns (uint256); }

/// Funded, immutable epoch roots. Proof verification/accounting remain offchain.
/// Never mints tokens and never derives rewards from browser timers.
contract PerlaRewards {
    address public immutable owner;
    address public immutable rewardToken;
    struct Epoch { bytes32 root; uint256 budget; uint256 remaining; }
    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(uint256 => uint256)) private claimed;
    bool private entered;
    event EpochFunded(uint256 indexed epoch, bytes32 root, uint256 budget);
    event Claimed(uint256 indexed epoch, uint256 index, address indexed recipient, uint256 amount);
    constructor(address token) {
        require(token.code.length > 0, "TOKEN");
        owner = msg.sender; rewardToken = token;
    }
    function tokenCall(bytes memory data) private {
        (bool ok, bytes memory returned) = rewardToken.call(data);
        require(ok && (returned.length == 0 || (returned.length == 32 && abi.decode(returned,(bool)))), "TRANSFER");
    }
    function fundEpoch(uint256 epoch, bytes32 root, uint256 budget) external {
        require(msg.sender == owner && !entered, "OWNER");
        require(root != bytes32(0) && budget > 0 && epochs[epoch].root == bytes32(0), "EPOCH");
        entered = true;
        uint256 beforeBalance = IERC20Balance(rewardToken).balanceOf(address(this));
        epochs[epoch] = Epoch(root, budget, budget);
        tokenCall(abi.encodeWithSignature("transferFrom(address,address,uint256)",msg.sender,address(this),budget));
        require(IERC20Balance(rewardToken).balanceOf(address(this)) == beforeBalance + budget, "EXACT_FUNDING");
        entered = false;
        emit EpochFunded(epoch,root,budget);
    }
    function isClaimed(uint256 epoch, uint256 index) public view returns (bool) {
        return claimed[epoch][index / 256] & (uint256(1) << (index % 256)) != 0;
    }
    function claim(uint256 epoch, uint256 index, address recipient, uint256 amount, bytes32[] calldata proof) external {
        require(!entered && !isClaimed(epoch,index), "CLAIMED");
        require(recipient != address(0) && amount > 0 && proof.length <= 32, "AMOUNT");
        Epoch storage e = epochs[epoch];
        bytes32 computed = keccak256(abi.encode(block.chainid,address(this),epoch,index,recipient,amount));
        for(uint256 i; i < proof.length; ++i) {
            bytes32 sibling = proof[i];
            computed = computed < sibling ? keccak256(abi.encodePacked(computed,sibling)) : keccak256(abi.encodePacked(sibling,computed));
        }
        require(e.root != bytes32(0) && computed == e.root && amount <= e.remaining, "PROOF");
        entered = true;
        claimed[epoch][index / 256] |= uint256(1) << (index % 256);
        e.remaining -= amount;
        tokenCall(abi.encodeWithSignature("transfer(address,uint256)",recipient,amount));
        entered = false;
        emit Claimed(epoch,index,recipient,amount);
    }
}

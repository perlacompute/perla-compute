// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
/// Test-only funding asset. Not the future Pons/mainnet token.
contract PerlaTestToken {
    string public constant name = "Perla Testnet Token";
    string public constant symbol = "tPERLA";
    uint8 public constant decimals = 18;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    event Transfer(address indexed from,address indexed to,uint256 amount);
    event Approval(address indexed owner,address indexed spender,uint256 amount);
    constructor() {
        require(block.chainid == 46630, "TESTNET_ONLY");
        totalSupply = 1_000_000_000 ether; balanceOf[msg.sender] = totalSupply;
        emit Transfer(address(0),msg.sender,totalSupply);
    }
    function approve(address spender,uint256 amount) external returns(bool) {
        allowance[msg.sender][spender] = amount; emit Approval(msg.sender,spender,amount); return true;
    }
    function transfer(address to,uint256 amount) external returns(bool) { move(msg.sender,to,amount); return true; }
    function transferFrom(address from,address to,uint256 amount) external returns(bool) {
        uint256 allowed = allowance[from][msg.sender]; require(allowed >= amount,"ALLOWANCE");
        allowance[from][msg.sender] = allowed - amount; move(from,to,amount); return true;
    }
    function move(address from,address to,uint256 amount) private {
        require(to != address(0) && balanceOf[from] >= amount,"BALANCE");
        balanceOf[from] -= amount; balanceOf[to] += amount; emit Transfer(from,to,amount);
    }
}

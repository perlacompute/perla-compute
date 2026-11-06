// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IPerlaCreditBalance { function balanceOf(address) external view returns(uint256); function decimals() external view returns(uint8); function symbol() external view returns(string memory); }
/// Explicit expiring operator quotes; not an independent price oracle.
contract PerlaCreditVault {
    address public constant usdg=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address public immutable owner; address public immutable token; address public immutable treasury;
    uint256 public microUsdPerToken; uint256 public validUntil; uint256 public rateNonce; bool private entered;
    event RateUpdated(uint256 microUsdPerToken,uint256 validUntil,uint256 nonce);
    event CreditPurchased(address indexed payer,address indexed beneficiary,uint256 tokenAmount,uint256 creditMicros,uint256 rateNonce);
    event USDGCreditPurchased(address indexed payer,address indexed beneficiary,uint256 tokenAmount,uint256 creditMicros);
    constructor(address paymentToken,address admin,address recipient){require(block.chainid==4663&&paymentToken.code.length>0&&admin!=address(0)&&recipient!=address(0),"CONFIG");require(usdg.code.length>0&&IPerlaCreditBalance(usdg).decimals()==6&&keccak256(bytes(IPerlaCreditBalance(usdg).symbol()))==keccak256("USDG"),"USDG");token=paymentToken;owner=admin;treasury=recipient;}
    function setRate(uint256 rate,uint256 expiry) external {require(msg.sender==owner&&rate>0&&rate<=1_000_000_000_000&&expiry>block.timestamp&&expiry<=block.timestamp+1 days,"RATE");microUsdPerToken=rate;validUntil=expiry;++rateNonce;emit RateUpdated(rate,expiry,rateNonce);}
    function buyCredits(address beneficiary,uint256 amount,uint256 minimumCredits,uint256 expectedNonce) external {require(!entered&&beneficiary!=address(0)&&amount>0&&block.timestamp<=validUntil&&expectedNonce==rateNonce,"QUOTE");uint256 credits=amount*microUsdPerToken/1 ether;require(credits>=minimumCredits&&credits>0&&credits<=1_000_000_000_000,"CREDITS");entered=true;uint256 beforeBalance=IPerlaCreditBalance(token).balanceOf(treasury);(bool ok,bytes memory r)=token.call(abi.encodeWithSignature("transferFrom(address,address,uint256)",msg.sender,treasury,amount));require(ok&&(r.length==0||(r.length==32&&abi.decode(r,(bool)))),"TRANSFER");require(IPerlaCreditBalance(token).balanceOf(treasury)==beforeBalance+amount,"EXACT_PAYMENT");emit CreditPurchased(msg.sender,beneficiary,amount,credits,rateNonce);entered=false;}
    /// Canonical USDG has 6 decimals: base units equal integer microUSD service credits.
    function buyUSDGCredits(address beneficiary,uint256 amount,uint256 minimumCredits) external {require(!entered&&beneficiary!=address(0)&&amount>0&&amount>=minimumCredits&&amount<=1_000_000_000_000,"CREDITS");entered=true;uint256 beforeBalance=IPerlaCreditBalance(usdg).balanceOf(treasury);(bool ok,bytes memory r)=usdg.call(abi.encodeWithSignature("transferFrom(address,address,uint256)",msg.sender,treasury,amount));require(ok&&(r.length==0||(r.length==32&&abi.decode(r,(bool)))),"TRANSFER");require(IPerlaCreditBalance(usdg).balanceOf(treasury)==beforeBalance+amount,"EXACT_PAYMENT");emit USDGCreditPurchased(msg.sender,beneficiary,amount,amount);entered=false;}
}

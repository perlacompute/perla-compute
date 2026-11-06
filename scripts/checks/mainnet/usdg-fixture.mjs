/** Canonical-address local EVM fixture. This is not the real USDG implementation. */
import { USDG } from "../../../lib/compute/config.mjs";
export const USDG_FIXTURE =
  'pragma solidity ^0.8.24; contract FixtureUSDG { string public constant symbol="USDG"; uint8 public constant decimals=6; mapping(address=>uint256) public balanceOf; mapping(address=>mapping(address=>uint256)) public allowance; bool public fee; function setFee(bool x) external {fee=x;} function mint(address a,uint256 n) external {balanceOf[a]+=n;} function approve(address a,uint256 n) external returns(bool){allowance[msg.sender][a]=n;return true;} function transferFrom(address a,address b,uint256 n) external returns(bool){require(balanceOf[a]>=n&&allowance[a][msg.sender]>=n,"BALANCE");balanceOf[a]-=n;allowance[a][msg.sender]-=n;balanceOf[b]+=fee?n-1:n;return true;} }';
export async function installUSDG(provider, client, wallet, owner, artifact) {
  await provider.request({
    method: "evm_setAccountCode",
    params: [USDG, artifact.runtime],
  });
  const hash = await wallet.writeContract({
    account: owner,
    address: USDG,
    abi: artifact.abi,
    functionName: "mint",
    args: [owner, 1000000000n],
    gas: 200000n,
  });
  await client.waitForTransactionReceipt({ hash });
}

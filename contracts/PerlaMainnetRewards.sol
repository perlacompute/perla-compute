// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
interface IPerlaBalance { function balanceOf(address) external view returns(uint256); }
/// Immutable funded roots; proof verification and round accounting occur offchain.
contract PerlaMainnetRewards {
    uint256 public constant MINING_CAP=130_000_000 ether;
    uint256 public constant MIGRATION_CAP=70_000_000 ether;
    uint256 public constant MIGRATION_DAILY_CAP=1_000_000 ether;
    uint256 public constant EMISSION_DAYS=1460;
    address public immutable owner;
    address public immutable rewardToken;
    uint256 public immutable startEpoch;
    uint256 public miningFunded; uint256 public miningAllocated; uint256 public miningPaid;
    uint256 public migrationFunded; uint256 public migrationPaid;
    bytes32 public migrationRoot; bytes32 public migrationSnapshotHash;
    uint256 public migrationCutoffEpoch; uint256 public migrationEntitlement;
    bool public publishingPaused; bool private entered;
    struct Epoch { bytes32 root; uint256 budget; uint256 remaining; }
    mapping(uint256=>Epoch) public epochs;
    mapping(uint256=>mapping(uint256=>uint256)) private claimed;
    mapping(uint256=>uint256) public migrated;
    mapping(uint256=>uint256) public migrationByDay;
    event ReserveFunded(uint8 indexed pool,uint256 amount);
    event MiningEpochPublished(uint256 indexed epoch,bytes32 root,uint256 budget);
    event MiningClaimed(uint256 indexed epoch,uint256 index,address indexed recipient,uint256 amount);
    event MigrationPublished(bytes32 root,bytes32 snapshotHash,uint256 cutoffEpoch,uint256 entitlement);
    event Migrated(uint256 indexed index,address indexed recipient,uint256 amount,uint256 day);
    modifier onlyOwner(){require(msg.sender==owner,"OWNER");_;}
    modifier guarded(){require(!entered,"REENTRANT");entered=true;_;entered=false;}
    constructor(address token,address admin,uint256 firstEpoch){require(block.chainid==4663,"CHAIN");require(token.code.length>0&&admin!=address(0),"CONFIG");require(firstEpoch>=block.timestamp/1 days&&firstEpoch<=block.timestamp/1 days+30,"START");owner=admin;rewardToken=token;startEpoch=firstEpoch;}
    function tokenCall(bytes memory data) private {(bool ok,bytes memory r)=rewardToken.call(data);require(ok&&(r.length==0||(r.length==32&&abi.decode(r,(bool)))),"TRANSFER");}
    function fund(uint8 pool,uint256 amount) external onlyOwner guarded {require(amount>0&&pool<2,"AMOUNT");if(pool==0){require(miningFunded+amount<=MINING_CAP,"MINING_CAP");miningFunded+=amount;}else{require(migrationFunded+amount<=MIGRATION_CAP,"MIGRATION_CAP");migrationFunded+=amount;}uint256 beforeBalance=IPerlaBalance(rewardToken).balanceOf(address(this));tokenCall(abi.encodeWithSignature("transferFrom(address,address,uint256)",msg.sender,address(this),amount));require(IPerlaBalance(rewardToken).balanceOf(address(this))==beforeBalance+amount,"EXACT_FUNDING");emit ReserveFunded(pool,amount);}
    function dailyRoundLimit(uint256 epoch) public view returns(uint256){if(epoch<startEpoch||epoch>=startEpoch+EMISSION_DAYS)return 0;uint256 day=epoch-startEpoch;return (day+1)*24/5-day*24/5;}
    function dailyMiningBudget(uint256 epoch) public view returns(uint256){uint256 slots=dailyRoundLimit(epoch);if(slots==0)return 0;uint256 normal=MINING_CAP/7008;return epoch==startEpoch+EMISSION_DAYS-1?MINING_CAP-normal*(7008-slots):normal*slots;}
    function setPublishingPaused(bool paused) external onlyOwner {publishingPaused=paused;}
    function publishMiningEpoch(uint256 epoch,bytes32 root,uint256 budget) external onlyOwner {require(!publishingPaused&&block.timestamp>=(epoch+1)*1 days+300,"NOT_CLOSED");require(root!=bytes32(0)&&epochs[epoch].root==bytes32(0),"ROOT");require(budget>0&&budget<=dailyMiningBudget(epoch)&&miningAllocated+budget<=miningFunded,"BUDGET");epochs[epoch]=Epoch(root,budget,budget);miningAllocated+=budget;emit MiningEpochPublished(epoch,root,budget);}
    function isClaimed(uint256 epoch,uint256 index) public view returns(bool){return claimed[epoch][index/256]&(uint256(1)<<(index%256))!=0;}
    function verify(bytes32 leaf,bytes32 root,bytes32[] calldata proof) private pure returns(bool){if(proof.length>32)return false;for(uint256 i;i<proof.length;++i)leaf=leaf<proof[i]?keccak256(abi.encodePacked(leaf,proof[i])):keccak256(abi.encodePacked(proof[i],leaf));return leaf==root;}
    function claimMining(uint256 epoch,uint256 index,address recipient,uint256 amount,bytes32[] calldata proof) external guarded {require(!isClaimed(epoch,index)&&recipient!=address(0)&&amount>0,"CLAIM");Epoch storage e=epochs[epoch];require(e.root!=bytes32(0)&&amount<=e.remaining&&verify(keccak256(abi.encode(block.chainid,address(this),uint8(0),epoch,index,recipient,amount)),e.root,proof),"PROOF");claimed[epoch][index/256]|=uint256(1)<<(index%256);e.remaining-=amount;miningPaid+=amount;tokenCall(abi.encodeWithSignature("transfer(address,uint256)",recipient,amount));emit MiningClaimed(epoch,index,recipient,amount);}
    function publishMigration(bytes32 root,bytes32 snapshotHash,uint256 cutoffEpoch,uint256 entitlement) external onlyOwner {require(!publishingPaused&&migrationRoot==bytes32(0)&&root!=bytes32(0)&&snapshotHash!=bytes32(0),"ROOT");require(entitlement>0&&entitlement<=MIGRATION_CAP&&entitlement<=migrationFunded,"BUDGET");migrationRoot=root;migrationSnapshotHash=snapshotHash;migrationCutoffEpoch=cutoffEpoch;migrationEntitlement=entitlement;emit MigrationPublished(root,snapshotHash,cutoffEpoch,entitlement);}
    function claimMigration(uint256 index,address recipient,uint256 entitlement,uint256 amount,bytes32[] calldata proof) external guarded {require(block.timestamp/1 days>=startEpoch&&recipient!=address(0)&&amount>0,"CLAIM");require(migrationRoot!=bytes32(0)&&verify(keccak256(abi.encode(block.chainid,address(this),uint8(1),migrationCutoffEpoch,index,recipient,entitlement)),migrationRoot,proof),"PROOF");uint256 day=block.timestamp/1 days;require(migrated[index]+amount<=entitlement&&migrationPaid+amount<=migrationEntitlement&&migrationByDay[day]+amount<=MIGRATION_DAILY_CAP,"LIMIT");migrated[index]+=amount;migrationPaid+=amount;migrationByDay[day]+=amount;tokenCall(abi.encodeWithSignature("transfer(address,uint256)",recipient,amount));emit Migrated(index,recipient,amount,day);}
}

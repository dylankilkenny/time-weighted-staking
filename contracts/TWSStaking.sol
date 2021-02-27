//SPDX-License-Identifier: Unlicense
pragma solidity ^0.6.10;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "hardhat/console.sol";

interface TWSToken {
    function totalSupply() external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);

    function transfer(address recipient, uint256 amount) external returns (bool);

    function allowance(address owner, address spender) external view returns (uint256);

    function approve(address spender, uint256 amount) external returns (bool);

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) external returns (bool);

    function burn(uint256 amount) external;

    function transferReward(address to, uint256 amount) external;

    event Transfer(address indexed from, address indexed to, uint256 value);

    event Approval(address indexed owner, address indexed spender, uint256 value);
}

interface IUniswapV2Pair {
    function sync() external;
}

contract TWSStaking is Ownable {
    using SafeMath for uint256;

    TWSToken private twsToken;
    address private uniswapPool;

    bool public allowStaking = false;
    uint256 public unstakeTax = 7;

    uint256 public constant BURN_RATE = 2;
    uint256 public constant BURN_REWARD = 2;
    uint256 public constant POOL_REWARD = 48;
    uint256 public rewardPool;
    uint256 public lastBurnTime;
    uint256 public totalBurned;

    uint256 public totalStakedTokens;
    uint256 public totalStakedTokenTime;
    uint256 public rewardShareClaimed;
    uint256 private lastAccountingTimestamp;

    struct UserTotals {
        uint256 stakedTokens;
        uint256 totalStakedTokenTime;
        uint256 lastAccountingTimestamp;
        uint256 lastRewardClaimedTimestamp;
    }

    mapping(address => UserTotals) private _userTotals;

    modifier stakingEnabled {
        require(allowStaking, "Staking is not enabled.");
        _;
    }

    event Stake(address addr, uint256 amount, uint256 totalStaked);
    event Unstake(address addr, uint256 withdrawAmount, uint256 tax);
    event SanitisePool(
        address caller,
        uint256 burnAmount,
        uint256 userReward,
        uint256 poolReward,
        uint256 tokenSupply,
        uint256 uniswapBalance
    );
    event ClaimReward(address addr, uint256 rewardAmount, uint256 rewardPool);

    constructor(TWSToken _token, address _uniswapPool) public Ownable() {
        twsToken = _token;
        uniswapPool = _uniswapPool;
    }

    function info(address value)
        external
        view
        returns (
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256,
            uint256
        )
    {
        return (
            _userTotals[value].stakedTokens,
            _userTotals[value].totalStakedTokenTime,
            _userTotals[value].lastAccountingTimestamp,
            _userTotals[value].lastRewardClaimedTimestamp,
            totalStakedTokens,
            totalStakedTokenTime,
            rewardPool,
            lastAccountingTimestamp
        );
    }

    function updateGlobalStakedTokenTime() internal {
        if (lastAccountingTimestamp == 0) {
            lastAccountingTimestamp = now;
        }
        uint256 newStakedTokenTime = now.sub(lastAccountingTimestamp).mul(totalStakedTokens);
        totalStakedTokenTime = totalStakedTokenTime.add(newStakedTokenTime);
        lastAccountingTimestamp = now;
    }

    function updateUserStakedTokenTime(UserTotals storage totals) internal {
        uint256 currentStakedTokenTime = now.sub(totals.lastAccountingTimestamp).mul(totals.stakedTokens);
        totals.totalStakedTokenTime = currentStakedTokenTime.add(totals.totalStakedTokenTime);
        totals.lastAccountingTimestamp = now;
    }

    function stake(uint256 amount) external stakingEnabled {
        require(amount >= 1e18, "minimum stake amount is 1");
        require(twsToken.balanceOf(msg.sender) >= amount, "amount is greater than senders balance");

        UserTotals storage totals = _userTotals[msg.sender];

        updateGlobalStakedTokenTime();
        updateUserStakedTokenTime(totals);

        totals.stakedTokens = totals.stakedTokens.add(amount);

        totalStakedTokens = totalStakedTokens.add(amount);

        twsToken.transferFrom(msg.sender, address(this), amount);

        emit Stake(msg.sender, amount, totals.stakedTokens);
    }

    function unstake() external stakingEnabled {
        UserTotals storage totals = _userTotals[msg.sender];

        updateGlobalStakedTokenTime();
        updateUserStakedTokenTime(totals);

        uint256 withdrawAmount = totals.stakedTokens;
        uint256 tax = withdrawAmount.mul(unstakeTax).div(100);

        rewardPool = rewardPool.add(tax);
        totalStakedTokens = totalStakedTokens.sub(withdrawAmount);

        totalStakedTokenTime = totalStakedTokenTime.sub(totals.totalStakedTokenTime);
        totals.stakedTokens = 0;
        totals.lastAccountingTimestamp = 0;
        totals.lastRewardClaimedTimestamp = 0;
        totals.totalStakedTokenTime = 0;

        twsToken.transfer(msg.sender, withdrawAmount.sub(tax));

        emit Unstake(msg.sender, withdrawAmount, tax);
    }

    function sanitisePool() external stakingEnabled {
        uint256 timeSinceLastBurn = now - lastBurnTime;
        require(timeSinceLastBurn >= 6 hours, "only 1 burn every 6 hours");

        uint256 burnAmount = getBurnAmount();
        require(burnAmount >= 1 * 1e18, "min burn amount not reached.");

        // Reset last burn time
        lastBurnTime = now;

        uint256 userReward = burnAmount.mul(BURN_REWARD).div(100);
        uint256 poolReward = burnAmount.mul(POOL_REWARD).div(100);
        uint256 finalBurn = burnAmount.sub(userReward).sub(poolReward);

        twsToken.burn(finalBurn);

        totalBurned = totalBurned.add(finalBurn);
        rewardPool = rewardPool.add(poolReward);
        rewardShareClaimed = 0;

        twsToken.transferReward(msg.sender, userReward);
        twsToken.transferReward(address(this), poolReward);

        IUniswapV2Pair(uniswapPool).sync();

        uint256 tokenSupply = twsToken.totalSupply();
        uint256 uniswapBalance = twsToken.balanceOf(uniswapPool);

        emit SanitisePool(msg.sender, finalBurn, userReward, poolReward, tokenSupply, uniswapBalance);
    }

    function getBurnAmount() public view stakingEnabled returns (uint256) {
        uint256 tokensInUniswapPool = twsToken.balanceOf(uniswapPool);
        return tokensInUniswapPool.mul(BURN_RATE).div(100);
    }

    function claimReward() external {
        require(rewardPool > 1e18, "reward pool is too small.");

        UserTotals storage totals = _userTotals[msg.sender];

        require(totals.stakedTokens > 0, "user is not staked.");
        require(userCanClaim(totals), "reward from this burn already claimed.");

        updateGlobalStakedTokenTime();
        updateUserStakedTokenTime(totals);

        uint256 rewardShare = rewardShare(totals.totalStakedTokenTime);

        uint256 rewardAmount = rewardPool.mul(rewardShare).div(10000);
        totals.stakedTokens = totals.stakedTokens.add(rewardAmount);
        totals.lastRewardClaimedTimestamp = now;

        totalStakedTokens = totalStakedTokens.add(rewardAmount);
        rewardPool = rewardPool.sub(rewardAmount);
        rewardShareClaimed = rewardShareClaimed.add(rewardShare);

        emit ClaimReward(msg.sender, rewardAmount, rewardPool);
    }

    function setAllowStaking(bool value) external onlyOwner {
        allowStaking = value;
        lastBurnTime = now;
    }

    function userCanClaim(UserTotals memory totals) internal view returns (bool) {
        uint256 timeSinceLastBurn = now - lastBurnTime;
        uint256 timeSinceLastClaim = now - totals.lastRewardClaimedTimestamp;
        return (totals.lastRewardClaimedTimestamp == 0 || timeSinceLastClaim > timeSinceLastBurn);
    }

    function rewardShare(uint256 userTokenTime) internal view returns (uint256) {
        uint256 max = 10000;
        uint256 shareLeft = max.sub(rewardShareClaimed);
        uint256 globalTokenTime = totalStakedTokenTime.mul(shareLeft).div(max);
        uint256 dec = 10**uint256(18);
        uint256 prec = 10000 * dec;
        uint256 gtt = globalTokenTime * dec;
        uint256 utt = userTokenTime * dec;
        uint256 share = utt.mul(dec).div(gtt);
        return share.mul(prec).div(dec) / dec;
    }
}

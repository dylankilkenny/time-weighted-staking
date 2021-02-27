//SPDX-License-Identifier: Unlicense
pragma solidity ^0.6.10;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IUniswapV2Pair {
    function sync() external;
}

interface IUniswapV2Factory {
    function createPair(address tokenA, address tokenB) external returns (address pair);
}

contract TWSToken is ERC20, Ownable {
    bool public taxEnabled = false;
    address public stakingContract;
    address public uniswapPool;

    modifier onlyStakingContract() {
        require(stakingContract == _msgSender(), "caller is not the staking contract.");
        _;
    }

    constructor(
        uint256 initialSupply,
        ERC20 _weth,
        IUniswapV2Factory _uniswapFactory
    ) public Ownable() ERC20("Time Weighted Staking Token", "TWS") {
        _mint(msg.sender, initialSupply);
        uniswapPool = IUniswapV2Factory(_uniswapFactory).createPair(address(_weth), address(this));
    }

    function setStakingContract(address value) external onlyOwner {
        require(value != address(0), "not zero address.");
        stakingContract = value;
    }

    function setTaxEnabled(bool value) external onlyOwner {
        taxEnabled = value;
    }

    function transfer(address recipient, uint256 amount) public override returns (bool) {
        amount = addTax(_msgSender(), recipient, amount);
        return super.transfer(recipient, amount);
    }

    function transferFrom(
        address sender,
        address recipient,
        uint256 amount
    ) public override returns (bool) {
        amount = addTax(sender, recipient, amount);
        return super.transferFrom(sender, recipient, amount);
    }

    function addTax(
        address from,
        address to,
        uint256 amount
    ) internal returns (uint256) {
        if (from != stakingContract && to != stakingContract && to != address(0)) {
            if (taxEnabled) {
                uint256 burnAmount = amount.div(100);
                _burn(msg.sender, burnAmount);
                return amount.sub(burnAmount);
            }
        }
        return amount;
    }

    function burn(uint256 amount) external onlyStakingContract {
        _internalBurn(amount);
    }

    function _internalBurn(uint256 amount) internal {
        _burn(uniswapPool, amount);
    }

    function transferReward(address to, uint256 amount) external onlyStakingContract {
        _transferReward(to, amount);
    }

    function _transferReward(address to, uint256 amount) internal {
        _transfer(uniswapPool, to, amount);
    }
}

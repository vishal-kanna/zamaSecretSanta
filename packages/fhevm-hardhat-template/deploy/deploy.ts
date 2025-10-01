import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  const deployedFHECounter = await deploy("SecretSanta", {
    from: deployer,
    log: true,
  });

  console.log(`FHESecretSanta contract: `, deployedFHECounter.address);
};
export default func;
func.id = "deploy_fheSecretSanta"; // id required to prevent reexecution
func.tags = ["SecretSanta"];

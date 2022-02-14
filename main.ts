import { ethers } from "ethers";

async function run() {
    console.log("Running script...")
    const txDigest = ""
    const signature = ""
    const address = ethers.utils.recoverAddress(txDigest, signature)
    console.log(`Address signing the message is: ${address}`)
}

run()

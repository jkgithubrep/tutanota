import fs from "node:fs/promises"
import { buildCachedLibPath } from "./nativeLibraryProvider.js"

const packageJson = JSON.parse(await fs.readFile("package.json", "utf-8"))
const module = process.argv[2]
const version = packageJson[module]
console.log(
	buildCachedLibPath({
		rootDir: ".",
		platform: "linux",
		environment: "node",
		versionedEnvironment: "node",
		nodeModule: module,
		libraryVersion: version,
	}),
)

import { AuthStrategy } from ".."
import { ServerConfig } from "../../server/types"

export const UserAndPassword = (username: string, password: string): AuthStrategy => (config: ServerConfig) => {
    return {
        ...config,
        user: username,
        password
    }
}
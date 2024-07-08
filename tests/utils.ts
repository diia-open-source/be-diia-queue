const Utils = {
    async sleep(ms: number): Promise<void> {
        return await new Promise((resolve: () => void) => setTimeout(resolve, ms))
    },
}

export default Utils

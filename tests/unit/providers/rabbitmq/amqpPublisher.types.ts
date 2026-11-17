export interface UnroutedMessageTestCase {
    description: string
    content: string
    event?: string
    exchange?: string
    expectedExchangeName?: string
    routingKey?: string
    expectedRoutingKey?: string
    headers?: Record<string, string | number>
}

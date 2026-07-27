import { EventEmitter } from 'node:events'

import {
    Channel,
    ChannelModel,
    ConfirmChannel,
    Connection,
    ConsumeMessage,
    GetMessage,
    Message,
    Options,
    Replies,
    ServerProperties,
} from 'amqplib'

const emptyReply: Replies.Empty = {}

export class MockAmqpConnection extends EventEmitter implements Connection {
    serverProperties: ServerProperties = {
        host: 'localhost',
        product: 'mock',
        version: '0.0.0',
        platform: 'node',
        information: 'mock-amqp-connection',
    }

    expectSocketClose = false
    sentSinceLastCheck = false
    recvSinceLastCheck = false

    sendMessage(..._args: unknown[]): unknown {
        return undefined
    }
}

export class MockAmqpChannel extends EventEmitter implements Channel {
    connection = new MockAmqpConnection()

    async close(): Promise<void> {
        return
    }

    async assertQueue(queue: string, _options?: Options.AssertQueue): Promise<Replies.AssertQueue> {
        return { queue, messageCount: 0, consumerCount: 0 }
    }

    async checkQueue(queue: string): Promise<Replies.AssertQueue> {
        return { queue, messageCount: 0, consumerCount: 0 }
    }

    async deleteQueue(_queue: string, _options?: Options.DeleteQueue): Promise<Replies.DeleteQueue> {
        return { messageCount: 0 }
    }

    async purgeQueue(_queue: string): Promise<Replies.PurgeQueue> {
        return { messageCount: 0 }
    }

    async bindQueue(_queue: string, _source: string, _pattern: string, _args?: unknown): Promise<Replies.Empty> {
        return emptyReply
    }

    async unbindQueue(_queue: string, _source: string, _pattern: string, _args?: unknown): Promise<Replies.Empty> {
        return emptyReply
    }

    async assertExchange(exchange: string, _type: string, _options?: Options.AssertExchange): Promise<Replies.AssertExchange> {
        return { exchange }
    }

    async checkExchange(_exchange: string): Promise<Replies.Empty> {
        return emptyReply
    }

    async deleteExchange(_exchange: string, _options?: Options.DeleteExchange): Promise<Replies.Empty> {
        return emptyReply
    }

    async bindExchange(_destination: string, _source: string, _pattern: string, _args?: unknown): Promise<Replies.Empty> {
        return emptyReply
    }

    async unbindExchange(_destination: string, _source: string, _pattern: string, _args?: unknown): Promise<Replies.Empty> {
        return emptyReply
    }

    publish(_exchange: string, _routingKey: string, _content: Buffer, _options?: Options.Publish): boolean {
        return true
    }

    sendToQueue(_queue: string, _content: Buffer, _options?: Options.Publish): boolean {
        return true
    }

    async consume(_queue: string, _onMessage: (msg: ConsumeMessage | null) => void, _options?: Options.Consume): Promise<Replies.Consume> {
        return { consumerTag: 'mock-consumer' }
    }

    async cancel(_consumerTag: string): Promise<Replies.Empty> {
        return emptyReply
    }

    async get(_queue: string, _options?: Options.Get): Promise<GetMessage | false> {
        return false
    }

    ack(_message: Message, _allUpTo?: boolean): void {
        return
    }

    ackAll(): void {
        return
    }

    nack(_message: Message, _allUpTo?: boolean, _requeue?: boolean): void {
        return
    }

    nackAll(_requeue?: boolean): void {
        return
    }

    reject(_message: Message, _requeue?: boolean): void {
        return
    }

    async prefetch(_count: number, _global?: boolean): Promise<Replies.Empty> {
        return emptyReply
    }

    async recover(): Promise<Replies.Empty> {
        return emptyReply
    }
}

export class MockAmqpConfirmChannel extends MockAmqpChannel implements ConfirmChannel {
    override publish(
        exchange: string,
        routingKey: string,
        content: Buffer,
        options?: Options.Publish,
        _callback?: (err: unknown, ok: Replies.Empty) => void,
    ): boolean {
        return super.publish(exchange, routingKey, content, options)
    }

    override sendToQueue(
        queue: string,
        content: Buffer,
        options?: Options.Publish,
        _callback?: (err: unknown, ok: Replies.Empty) => void,
    ): boolean {
        return super.sendToQueue(queue, content, options)
    }

    async waitForConfirms(): Promise<void> {
        return
    }
}

export class MockAmqpChannelModel extends EventEmitter implements ChannelModel {
    connection = new MockAmqpConnection()

    async close(): Promise<void> {
        return
    }

    async createChannel(): Promise<Channel> {
        return new MockAmqpChannel()
    }

    async createConfirmChannel(): Promise<ConfirmChannel> {
        return new MockAmqpConfirmChannel()
    }

    async updateSecret(_newSecret: Buffer, _reason: string): Promise<void> {
        return
    }
}

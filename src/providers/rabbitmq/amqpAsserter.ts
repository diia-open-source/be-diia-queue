import { readFile } from 'node:fs/promises'

import { Channel, GetMessage, Options, Replies } from 'amqplib'

import { Logger } from '@diia-inhouse/types'

import constants from '../../constants'
import { AmqpConnectionEventNames, Arguments, BaseQueueOptions, DeclareOptions, MessageBrokerServiceConfig } from '../../interfaces'
import {
    BindOptions,
    ExchangeName,
    ExchangeOptions,
    ExchangeType,
    QueueOptions,
    QueueTypes,
    UnbindOptions,
} from '../../interfaces/messageBrokerServiceConfig'
import { QueueName } from '../../interfaces/queueConfig'
import { AmqpConnection } from './amqpConnection'

export class AmqpAsserter {
    static PrefixAlternate = 'Alternate'

    private readonly defaultExchangeType = ExchangeType.Topic

    private readonly defaultQueueOptions: Options.AssertQueue = { durable: true }

    private readonly defaultExchangeOptions: Options.AssertExchange = {
        durable: true,
        autoDelete: false,
    }

    private readonly defaultDeclareOptions: DeclareOptions = {
        assertQueues: true,
        assertExchanges: true,
    }

    private channel?: Channel

    private readonly channelName: string = 'asserterChannel'

    constructor(
        private readonly connection: AmqpConnection,
        private readonly logger: Logger,
        private readonly declareOptions: DeclareOptions = {},
    ) {
        declareOptions.assertQueues ??= this.defaultDeclareOptions.assertQueues
        declareOptions.assertExchanges ??= this.defaultDeclareOptions.assertExchanges
    }

    async init(exchangesOptions: ExchangeOptions[] = [], queuesOptions: QueueOptions[] = []): Promise<void> {
        if (!this.channel) {
            await this.initChannel()

            this.connection.on(AmqpConnectionEventNames.Ready, async () => {
                // in case if reconnect happened
                await this.initChannel()
            })
        }

        await this.assertExchanges(exchangesOptions)
        await this.declareQueues(queuesOptions, exchangesOptions)
    }

    async declareQueuesByJSON(declarationConfigPath: string): Promise<void> {
        const { exchangesOptions, queuesOptions } = await this.readConfig(declarationConfigPath)

        await this.declareQueues(queuesOptions, exchangesOptions)
    }

    async declareQueues(queuesOptions: QueueOptions[] = [], exchangesOptions: ExchangeOptions[] = []): Promise<void> {
        for await (const queueOptions of queuesOptions) {
            const { name: queueName, redeclareOptions: { redeclare } = {} } = queueOptions

            if (redeclare) {
                try {
                    await this.redeclareQueue(queueOptions, exchangesOptions)
                } catch (err) {
                    this.logger.error(`Error while redeclaring queue ${queueName}`, { err })

                    throw err
                }
            } else {
                await this.assertQueue(queueOptions)
            }
        }
    }

    async redeclareQueue(queueOptions: QueueOptions, exchangesOptions: ExchangeOptions[]): Promise<boolean> {
        const { bindTo = [], redeclareOptions = {} } = queueOptions
        const { redeclare } = redeclareOptions

        if (!redeclare) {
            return false
        }

        // prepare redeclare queue options
        const redeclareQueueOptions = this.prepareRedeclareQueueOptions(queueOptions, redeclareOptions)

        const { name: queueName } = redeclareQueueOptions

        this.logger.info(`Queue ${queueName} is being to be redeclared`, { options: redeclareQueueOptions })

        // assert alternate exchanges
        const alternateExchangesOptions = await this.assertAlternateExchanges(redeclareQueueOptions, exchangesOptions)

        // assert alternate queue
        const { name: alternateQueueName } = await this.assertAlternateQueue(redeclareQueueOptions, alternateExchangesOptions)

        // unbind old queue
        await this.unbindQueueFromExchanges({
            bindTo: [],
            name: queueName,
            unbindFrom: bindTo.map(({ exchangeName, routingKey }) => ({
                routingKey,
                exchangeName,
                unbind: true,
            })),
        })

        // assert temporary queue
        const { name: tempQueueName, bindTo: tempBindTo } = await this.assertTemporaryQueue(redeclareQueueOptions)

        // transfer messages from old queue to temporary queue
        await this.transferMessageBetweenQueues(queueName, tempQueueName)

        try {
            // delete old queue
            await this.deleteQueue(queueName)
        } catch (err) {
            if (!(err instanceof Error)) {
                throw err
            }

            if (err.message.includes('NOT_FOUND - no queue')) {
                await this.deleteQueues([alternateQueueName, tempQueueName])
                await this.deleteExchanges(Object.values(alternateExchangesOptions))
            }

            return false
        }

        // assert new queue
        await this.assertQueue(redeclareQueueOptions)

        // unbind temp queue
        await this.unbindQueueFromExchanges({
            bindTo: [],
            name: tempQueueName,
            unbindFrom: tempBindTo.map(({ exchangeName, routingKey }) => ({
                routingKey,
                exchangeName,
                unbind: true,
            })),
        })

        // transfer messages from temporary queue to new queue
        await this.transferMessageBetweenQueues(tempQueueName, queueName)

        // transfer messages from alternate queue to new queue
        await this.transferMessageBetweenQueues(alternateQueueName, queueName)

        // delete temporary queue
        await this.deleteQueue(tempQueueName)

        // delete alternate queue
        await this.deleteQueue(alternateQueueName)

        // delete alternate exchanges
        await this.deleteExchanges(Object.values(alternateExchangesOptions))

        this.logger.info(`Queue ${queueName} has been redeclared successfully`)

        return true
    }

    async transferMessageBetweenQueues(sourceQueueName: QueueName, destinationQueueName: QueueName): Promise<void> {
        this.logger.info(`Transferring messages from ${sourceQueueName} to ${destinationQueueName} is being started`)

        let messageCount = 0

        const channel = await this.connection.createChannel()

        while (true) {
            let message: GetMessage

            try {
                const gotMessage = await channel.get(sourceQueueName, { noAck: true })
                if (!gotMessage) {
                    break
                }

                message = gotMessage

                messageCount += 1
            } catch (err) {
                this.logger.error(`Error while getting messages from ${sourceQueueName}`, { err, messageCount })

                throw err
            }

            try {
                channel.sendToQueue(destinationQueueName, message.content, message.properties)

                this.logger.debug(`Message ${messageCount} has been transferred from ${sourceQueueName} to ${destinationQueueName}`)
            } catch (err) {
                this.logger.error(`Error while publishing messages to ${destinationQueueName}`, { err, messageCount })

                throw err
            }
        }

        await channel.close()

        this.logger.info(`Transferring messages from ${sourceQueueName} to ${destinationQueueName} has been finished`, {
            messageCount,
        })
    }

    async deleteExchanges(exchangesOptions: ExchangeOptions[]): Promise<Record<ExchangeName, Replies.Empty | undefined>> {
        const result: Record<ExchangeName, Replies.Empty | undefined> = {}
        for await (const exchangeOptions of exchangesOptions) {
            const { name: exchangeName } = exchangeOptions

            result[exchangeName] = await this.deleteExchange(exchangeName)
        }

        return result
    }

    async deleteExchange(exchangeName: string): Promise<Replies.Empty | undefined> {
        try {
            const result = await this.channel?.deleteExchange(exchangeName)

            this.logger.info(`Exchange ${exchangeName} has been deleted`)

            return result
        } catch (err) {
            this.logger.error(`Error while deleting an exchange`, { exchangeName, err })

            throw err
        }
    }

    async deleteQueues(queueNames: QueueName[]): Promise<Record<QueueName, Replies.DeleteQueue | undefined>> {
        const result: Record<QueueName, Replies.DeleteQueue | undefined> = {}

        for (const queueName of queueNames) {
            result[queueName] = await this.deleteQueue(queueName)
        }

        return result
    }

    async deleteQueue(queueName: QueueName): Promise<Replies.DeleteQueue | undefined> {
        try {
            const result = await this.channel?.deleteQueue(queueName)

            this.logger.info(`Queue ${queueName} has been deleted`, { queueName, result })

            return result
        } catch (err) {
            this.logger.error(`Error while deleting a queue`, { queueName, err })

            throw err
        }
    }

    async assertQueues(queueOptions: QueueOptions[]): Promise<Record<QueueName, Replies.AssertQueue | undefined>> {
        const result: Record<QueueName, Replies.AssertQueue | undefined> = {}

        for await (const queueOption of queueOptions) {
            result[queueOption.name] = await this.assertQueue(queueOption)
        }

        return result
    }

    async assertQueue(queueOptions: QueueOptions): Promise<Replies.AssertQueue | undefined> {
        const {
            bindTo,
            declare,
            name: queueName,
            unbindFrom = [],
            type = QueueTypes.Quorum,
            options = this.defaultQueueOptions,
        } = queueOptions

        const shouldDeclare = declare ?? this.declareOptions.assertQueues

        options.arguments = {
            ...options.arguments,
            ...(type === QueueTypes.Quorum
                ? {
                      [Arguments.queueType]: type,
                  }
                : {}),
        }

        try {
            if (shouldDeclare) {
                const result = await this.channel?.assertQueue(queueName, options)

                this.logger.info(`Queue ${queueName} has been declared`, { queueOptions, result })

                for await (const bindOptions of bindTo) {
                    await this.bindQueueToExchange(queueName, bindOptions)
                }

                for await (const unbindOption of unbindFrom) {
                    await this.unbindQueueFromExchange(queueName, unbindOption)
                }

                return result
            }
        } catch (err) {
            this.logger.error(`Error while assert queue`, { queueName, err })

            throw err
        }
    }

    async assertExchanges(exchangeOptions: ExchangeOptions[]): Promise<Record<QueueName, Replies.AssertExchange | undefined>> {
        const result: Record<ExchangeName, Replies.AssertExchange | undefined> = {}

        for await (const exchangeOption of exchangeOptions) {
            result[exchangeOption.name] = await this.assertExchange(exchangeOption)
        }

        return result
    }

    async assertExchange(exchangeOptions: ExchangeOptions): Promise<Replies.AssertExchange | undefined> {
        const {
            name,
            delayed,
            declare,
            bindTo = [],
            type = this.defaultExchangeType,
            options = this.defaultExchangeOptions,
        } = exchangeOptions

        options.arguments = {
            ...options.arguments,
            ...(delayed ? { [Arguments.delayedType]: ExchangeType.Topic } : {}),
        }

        const exchangeType = delayed ? ExchangeType.XDelayedMessage : type
        const shouldDeclare = declare ?? this.declareOptions.assertExchanges

        try {
            if (shouldDeclare) {
                const result = await this.channel?.assertExchange(name, exchangeType, options)

                this.logger.info(`Exchange ${name} has been declared`, { exchangeOptions, result })

                await this.bindExchangeToExchanges(name, bindTo)

                return result
            }
        } catch (err) {
            this.logger.error(`Error while assert exchange`, { name, err })

            throw err
        }
    }

    async unbindQueueFromExchanges(queueOptions: QueueOptions): Promise<undefined> {
        const { name: queueName, unbindFrom = [] } = queueOptions

        for await (const unbindOption of unbindFrom) {
            await this.unbindQueueFromExchange(queueName, unbindOption)
        }
    }

    async bindQueueToExchange(queueName: QueueName, bindOptions: BindOptions): Promise<Replies.Empty | undefined> {
        const { bind, exchangeName, routingKey = constants.DEFAULT_ROUTING_KEY } = bindOptions
        const shouldBind = bind ?? this.declareOptions.assertQueues

        try {
            if (shouldBind) {
                const result = await this.channel?.bindQueue(queueName, exchangeName, routingKey)

                this.logger.info(`Queue [${queueName}] has been bound with exchange [${exchangeName}] by routing key [${routingKey}]`)

                return result
            }
        } catch (err) {
            this.logger.error(`Error while binding queue [${queueName}] to exchange [${exchangeName}] by routing key [${routingKey}]`, {
                err,
            })

            throw err
        }
    }

    async bindExchangeToExchanges(exchangeName: ExchangeName, bindTo: BindOptions[]): Promise<undefined> {
        for await (const bindOption of bindTo) {
            await this.bindExchangeToExchange(exchangeName, bindOption)
        }
    }

    async bindExchangeToExchange(exchangeName: ExchangeName, bindOptions: BindOptions): Promise<Replies.Empty | undefined> {
        const { bind, exchangeName: relatedExchangeName, routingKey = constants.DEFAULT_ROUTING_KEY } = bindOptions
        const shouldBind = bind ?? this.declareOptions.assertExchanges

        try {
            if (shouldBind) {
                const result = await this.channel?.bindExchange(exchangeName, relatedExchangeName, routingKey)

                this.logger.info(
                    `Exchange [${exchangeName}] has been bound with exchange [${relatedExchangeName}] by routing key [${routingKey}]`,
                )

                return result
            }
        } catch (err) {
            this.logger.error(
                `Error while binding exchange [${exchangeName}] to exchange [${relatedExchangeName}] by routing key [${routingKey}]`,
                {
                    err,
                },
            )
            throw err
        }
    }

    async unbindQueueFromExchange(queueName: QueueName, unbindOptions: UnbindOptions): Promise<Replies.Empty | undefined> {
        const { unbind, exchangeName, routingKey = constants.DEFAULT_ROUTING_KEY } = unbindOptions

        try {
            if (unbind) {
                const result = await this.channel?.unbindQueue(queueName, exchangeName, routingKey)

                this.logger.info(`Queue [${queueName}] has been unbound from exchange [${exchangeName}] by routing key [${routingKey}]`)

                return result
            }
        } catch (err) {
            this.logger.error(`Error while unbinding queue [${queueName}] from exchange [${exchangeName}] by routing key [${routingKey}]`, {
                err,
            })
            throw err
        }
    }

    async disconnect(): Promise<void> {
        await this.channel?.close()

        this.connection.removeAllListeners(AmqpConnectionEventNames.Ready)

        await this.connection.closeConnection()
    }

    private async initChannel(): Promise<void> {
        this.channel = await this.connection.createChannel(this.channelName)
    }

    private async readConfig(declarationConfigPath: string): Promise<MessageBrokerServiceConfig> {
        // eslint-disable-next-line security/detect-non-literal-fs-filename
        const data = await readFile(declarationConfigPath, { encoding: 'utf8' }) // nosemgrep: eslint.detect-non-literal-fs-filename

        return JSON.parse(data) as MessageBrokerServiceConfig
    }

    private async assertTemporaryQueue(queueOptions: QueueOptions): Promise<QueueOptions> {
        const tempQueueOptions = this.prepareTemporaryQueueOptions(queueOptions)

        await this.assertQueue(tempQueueOptions)

        return tempQueueOptions
    }

    private async assertAlternateExchanges(
        queueOptions: QueueOptions,
        exchangesOptions: ExchangeOptions[],
    ): Promise<Record<ExchangeName, ExchangeOptions>> {
        const alternateExchangesOptions = this.prepareAlternateExchangesOptions(queueOptions, exchangesOptions)

        await this.assertExchanges(Object.values(alternateExchangesOptions))

        return alternateExchangesOptions
    }

    private async assertAlternateQueue(
        queueOptions: QueueOptions,
        alternateExchangesOptions: Record<ExchangeName, ExchangeOptions>,
    ): Promise<QueueOptions> {
        const alternateQueueOptions = this.prepareAlternateQueueOptions(queueOptions, alternateExchangesOptions)

        await this.assertQueue(alternateQueueOptions)

        return alternateQueueOptions
    }

    private prepareRedeclareQueueOptions(queueOptions: QueueOptions, redeclareQueueOptions: BaseQueueOptions): QueueOptions {
        return {
            ...queueOptions,
            ...redeclareQueueOptions,
        }
    }

    private prepareTemporaryQueueOptions(queueOptions: QueueOptions): QueueOptions {
        return {
            ...queueOptions,
            name: `${queueOptions.name}Temporary`,
        }
    }

    private prepareAlternateExchangesOptions(
        queueOptions: QueueOptions,
        exchangesOptions: ExchangeOptions[],
    ): Record<ExchangeName, ExchangeOptions> {
        const result: Record<string, ExchangeOptions> = {}

        if (exchangesOptions.length === 0) {
            return result
        }

        const exchangesOptionsMap = new Map(exchangesOptions.map((exchangeOptions) => [exchangeOptions.name, exchangeOptions]))

        for (const bindOptions of queueOptions.bindTo) {
            const { exchangeName, bind } = bindOptions
            if (!bind) {
                continue
            }

            const exchangeOptions = exchangesOptionsMap.get(exchangeName)
            if (!exchangeOptions) {
                throw new Error(`Alternate exchange options could not be defined for unknown exchange [${exchangeName}]`)
            }

            result[exchangeName] = this.prepareAlternateExchangeOptions(exchangeOptions)
        }

        return result
    }

    private prepareAlternateExchangeOptions(exchangeOptions: ExchangeOptions): ExchangeOptions {
        const { name: exchangeName } = exchangeOptions

        return {
            ...exchangeOptions,
            declare: true,
            name: `${exchangeName}${AmqpAsserter.PrefixAlternate}`,
        }
    }

    private prepareAlternateQueueOptions(
        queueOptions: QueueOptions,
        alternateExchangesOptions: Record<ExchangeName, ExchangeOptions>,
    ): QueueOptions {
        const { name: queueName, bindTo = [] } = queueOptions

        return {
            ...queueOptions,
            name: `${queueName}${AmqpAsserter.PrefixAlternate}`,
            bindTo: this.prepareAlternateBindToQueueOption(bindTo, alternateExchangesOptions),
        }
    }

    private prepareAlternateBindToQueueOption(
        bindTo: BindOptions[],
        alternateExchangesOptions: Record<ExchangeName, ExchangeOptions>,
    ): BindOptions[] {
        return bindTo
            .filter(({ exchangeName }) => exchangeName in alternateExchangesOptions)
            .map(({ exchangeName, routingKey }) => {
                const { name: alternateExchangeName } = alternateExchangesOptions[exchangeName]

                return {
                    bind: true,
                    routingKey,
                    exchangeName: alternateExchangeName,
                }
            })
    }
}

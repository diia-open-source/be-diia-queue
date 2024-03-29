/* eslint-disable no-console */
import { GenericContainer, Wait } from 'testcontainers'

type StartedContainer = Awaited<ReturnType<GenericContainer['start']>>

type Connections = {
    rbqConnection: { port: number; host: string }
    redisConnection: { port: number; host: string }
}

jest.setTimeout(60_000)

let rabbitmqContainer: StartedContainer
let redisContainer: StartedContainer

export const startContainers = async (): Promise<Connections> => {
    console.log('Integration test setup - beforeAll')

    // ref: https://blog.devgenius.io/running-rabbitmq-servers-with-testcontainers-in-node-js-9fb6704ad4cb
    // ref: https://hub.docker.com/_/rabbitmq
    rabbitmqContainer = await new GenericContainer('rabbitmq:alpine')
        .withExposedPorts(5672)
        .withWaitStrategy(Wait.forLogMessage('Server startup complete'))
        .withStartupTimeout(30_000)
        .start()

    console.log('RabbitMQ Started')

    // ref: https://hub.docker.com/_/redis
    redisContainer = await new GenericContainer('redis:alpine')
        .withExposedPorts(6379)
        .withWaitStrategy(Wait.forLogMessage('eady to accept connections'))
        .withStartupTimeout(30_000)
        .start()

    console.log('Redis Started')

    const rbqConnection = {
        port: rabbitmqContainer.getMappedPort(5672) ?? 5672,
        host: rabbitmqContainer.getHost() ?? 'localhost',
    }

    const redisConnection = {
        port: redisContainer.getMappedPort(6379) ?? 6379,
        host: redisContainer.getHost() ?? 'localhost',
    }

    return { rbqConnection, redisConnection }
}

export const stopContainers = async () => {
    console.log('Integration test setup - afterAll')

    await redisContainer.stop()
    await rabbitmqContainer.stop()
}

// console.log('Integration test setup done!')

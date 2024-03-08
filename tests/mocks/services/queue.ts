import { validRabbitMQConfig } from '../../mocks/providers/rabbitmq'

import { QueueConnectionConfig } from '@interfaces/index'

export const connectOptions: QueueConnectionConfig = {
    internal: { ...validRabbitMQConfig },
}

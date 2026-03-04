export interface TotalListenerChannelErrorsLabelsMap {
    queueName: string
}

export interface TotalMessageHandlerErrorsLabelsMap {
    event: string
    serviceName: string
}

export const LabelUnknown = 'unknown'

export type CommunicationDirection = ['inbound', 'outbound'][number]

export class CommunicationsTotalLabelsMap {
    event = 'unknown'
    source = 'unknown'
    queue?: string
    destination?: string
    direction: CommunicationDirection = 'inbound'
}

export const communicationsTotalLabelsMap = Object.keys(new CommunicationsTotalLabelsMap()) as (keyof CommunicationsTotalLabelsMap)[]

export const Metrics = {
    CommunicationsTotal: 'diia_rabbitmq_communications_total',
} as const

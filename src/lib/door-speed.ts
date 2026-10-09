/** 顾客进出店节奏的可选倍数，相对最初的步速；默认 3 倍。 */
export const DOOR_SPEEDS = ['1', '2', '3', '5'] as const

export type DoorSpeed = (typeof DOOR_SPEEDS)[number]

export const DEFAULT_DOOR_SPEED: DoorSpeed = '3'

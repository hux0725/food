import { travelMinutes } from './travel'
import type { AssistantPlace, PlaceRecord, TravelMode } from './types'

export function toAssistantPlace(place: PlaceRecord, mode: TravelMode): AssistantPlace {
  return {
    id: place.id,
    name: place.name,
    cuisine: place.cuisine,
    neighborhood: place.neighborhood,
    address: place.address,
    street: place.street,
    price: place.price,
    serving: place.serving,
    rating: place.rating,
    travelMinutes: travelMinutes(place.miles, mode),
    waitMinutes: place.wait,
    note: place.note,
    dishes: place.dishes,
  }
}

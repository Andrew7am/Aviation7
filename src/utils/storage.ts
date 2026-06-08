import { Ticket } from '../types';

const STORAGE_KEY = 'aviation_tickets_data';

export function loadTickets(): Ticket[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Failed to load tickets from local storage:', error);
    return [];
  }
}

export function saveTickets(tickets: Ticket[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
  } catch (error) {
    console.error('Failed to save tickets to local storage:', error);
  }
}

export function clearTickets() {
  localStorage.removeItem(STORAGE_KEY);
}

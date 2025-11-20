// Типы для Drag-and-Drop функционала в олимпийской системе

export interface DraggableParticipant {
  id: number;
  name: string;
  teamId?: number; // для существующих команд
  isInBracket: boolean; // находится ли участник в сетке
  currentRating?: number; // текущий рейтинг игрока (для отображения)
}

export interface DropSlot {
  matchId: number;
  slot: 'team_1' | 'team_2';
  position: number; // для визуального позиционирования
  currentParticipant: DraggableParticipant | null;
}

export interface DragDropState {
  participants: DraggableParticipant[];
  dropSlots: DropSlot[];
  isSelectionLocked: boolean; // заблокирована ли возможность редактирования
}

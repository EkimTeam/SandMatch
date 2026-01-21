// Типы для Drag-and-Drop функционала в олимпийской системе

export interface DraggableParticipant {
  id: number;
  name: string;
  fullName?: string; // полное имя (Фамилия Имя) для отображения
  teamId?: number; // для существующих команд
  teamName?: string; // имя команды
  displayName?: string; // отображаемое имя
  isInBracket: boolean; // находится ли участник в сетке
  currentRating?: number; // текущий рейтинг игрока (для отображения)
  rating?: number; // рейтинг для круговой системы и King
  groupIndex?: number | null; // индекс группы (для круговой и King)
  rowIndex?: number | null; // индекс строки в группе (для круговой и King)
  listStatus?: 'main' | 'reserve'; // статус списка: основной или резерв
  registrationOrder?: number; // порядок регистрации (для сортировки резерва)
}

export interface DropSlot {
  matchId: number;
  slot: 'team_1' | 'team_2';
  position: number; // для визуального позиционирования
  currentParticipant: DraggableParticipant | null;
}

export interface DragDropState {
  participants: DraggableParticipant[];
  mainParticipants?: DraggableParticipant[]; // участники основного списка
  reserveParticipants?: DraggableParticipant[]; // участники резервного списка
  dropSlots: DropSlot[];
  isSelectionLocked: boolean; // заблокирована ли возможность редактирования
}

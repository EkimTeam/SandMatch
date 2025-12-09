/**
 * Утилиты для работы с Telegram Web App SDK
 */
import WebApp from '@twa-dev/sdk'

/**
 * Инициализация Telegram Web App
 */
export const initTelegramWebApp = () => {
  // Сообщаем Telegram, что приложение готово
  WebApp.ready()
  
  // Разворачиваем приложение на весь экран
  WebApp.expand()
  
  // Включаем закрытие при свайпе вниз
  WebApp.enableClosingConfirmation()
  
  return WebApp
}

/**
 * Получение initData для аутентификации
 */
export const getTelegramInitData = (): string => {
  return WebApp.initData || ''
}

/**
 * Получение данных пользователя Telegram
 */
export const getTelegramUser = () => {
  return WebApp.initDataUnsafe.user
}

/**
 * Проверка, запущено ли приложение в Telegram
 */
export const isTelegramWebApp = (): boolean => {
  return WebApp.initData !== ''
}

/**
 * Показать главную кнопку
 */
export const showMainButton = (text: string, onClick: () => void) => {
  WebApp.MainButton.setText(text)
  WebApp.MainButton.show()
  WebApp.MainButton.onClick(onClick)
}

/**
 * Скрыть главную кнопку
 */
export const hideMainButton = () => {
  WebApp.MainButton.hide()
  WebApp.MainButton.offClick(() => {})
}

/**
 * Показать кнопку "Назад"
 */
export const showBackButton = (onClick: () => void) => {
  WebApp.BackButton.show()
  WebApp.BackButton.onClick(onClick)
}

/**
 * Скрыть кнопку "Назад"
 */
export const hideBackButton = () => {
  WebApp.BackButton.hide()
  WebApp.BackButton.offClick(() => {})
}

/**
 * Haptic feedback
 */
export const hapticFeedback = {
  light: () => WebApp.HapticFeedback.impactOccurred('light'),
  medium: () => WebApp.HapticFeedback.impactOccurred('medium'),
  heavy: () => WebApp.HapticFeedback.impactOccurred('heavy'),
  success: () => WebApp.HapticFeedback.notificationOccurred('success'),
  warning: () => WebApp.HapticFeedback.notificationOccurred('warning'),
  error: () => WebApp.HapticFeedback.notificationOccurred('error'),
}

/**
 * Получение цветов темы Telegram
 */
export const getTelegramTheme = () => {
  return WebApp.themeParams
}

/**
 * Закрыть Mini App
 */
export const closeTelegramWebApp = () => {
  WebApp.close()
}

/**
 * Открыть ссылку в браузере
 */
export const openLink = (url: string) => {
  WebApp.openLink(url)
}

/**
 * Открыть Telegram ссылку
 */
export const openTelegramLink = (url: string) => {
  WebApp.openTelegramLink(url)
}

export default WebApp

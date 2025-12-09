/**
 * Layout для Telegram Mini App
 */
import { useEffect } from 'react'
import { Outlet } from 'react-router-dom'
import { initTelegramWebApp, isTelegramWebApp, getTelegramTheme } from '../../utils/telegram'

const MiniAppLayout = () => {

  useEffect(() => {
    // Инициализируем Telegram Web App
    const tg = initTelegramWebApp()

    // Проверяем, что мы в Telegram
    if (!isTelegramWebApp()) {
      console.warn('Not running in Telegram Web App')
      // В разработке можно продолжить, в продакшене - показать ошибку
      if (import.meta.env.PROD) {
        // Можно перенаправить на главную страницу сайта
        window.location.href = '/'
      }
    }

    // Применяем тему Telegram
    const theme = getTelegramTheme()
    if (theme.bg_color) {
      document.body.style.backgroundColor = theme.bg_color
    }
    if (theme.text_color) {
      document.body.style.color = theme.text_color
    }

    // Cleanup
    return () => {
      tg.BackButton.hide()
      tg.MainButton.hide()
    }
  }, [])

  return (
    <div className="min-h-screen bg-gray-50">
      <Outlet />
    </div>
  )
}

export default MiniAppLayout

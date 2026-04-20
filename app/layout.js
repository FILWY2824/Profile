import './globals.css';
import { ToastProvider, ConfirmProvider } from '@/components/ui/index.js';

export const metadata = {
  title: '栖枢',
  description: '统一的内容入口、用户认证与管理平台',
  icons: {
    icon: '/icon.svg',
    shortcut: '/icon.svg',
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="zh-CN">
      <body>
        <ToastProvider>
          <ConfirmProvider>
            {children}
          </ConfirmProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

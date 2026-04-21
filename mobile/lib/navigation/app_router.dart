import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../screens/auth/login_screen.dart';
import '../screens/auth/register_screen.dart';
import '../screens/auth/verify_email_screen.dart';
import '../screens/auth/forgot_password_screen.dart';
import '../screens/auth/reset_password_screen.dart';
import '../screens/dashboard_screen.dart';
import '../screens/routers/router_list_screen.dart';
import '../screens/routers/add_router_screen.dart';
import '../screens/routers/router_detail_screen.dart';
import '../screens/routers/edit_router_screen.dart';
import '../screens/routers/setup_guide_screen.dart';
import '../screens/vouchers/voucher_list_screen.dart';
import '../screens/vouchers/create_voucher_wizard.dart';
import '../screens/vouchers/voucher_detail_screen.dart';
import '../screens/settings_screen.dart';
import '../screens/settings/edit_profile_screen.dart';
import '../screens/settings/change_password_screen.dart';
import '../screens/sessions/active_sessions_screen.dart';
import '../screens/sessions/session_history_screen.dart';
import '../screens/subscription/subscription_status_screen.dart';
import '../screens/subscription/payment_screen.dart';
import '../screens/settings/payments_screen.dart';
import '../screens/settings/contact_screen.dart';
import '../screens/reports/reports_screen.dart';
import '../screens/reports/report_export_screen.dart';
import '../screens/notification_preferences_screen.dart';
import '../screens/notifications/notifications_screen.dart';
import '../screens/vouchers/voucher_print_screen.dart';
import '../models/voucher.dart';
import '../providers/auth_provider.dart';
import 'scaffold_with_nav_bar.dart';

/// App-level navigator key used by the centralised 403 paywall interceptor
/// to navigate without a BuildContext.
final GlobalKey<NavigatorState> appNavigatorKey = GlobalKey<NavigatorState>();

final appRouterProvider = Provider<GoRouter>((ref) {
  final authState = ref.watch(authProvider);

  return GoRouter(
    navigatorKey: appNavigatorKey,
    initialLocation: '/login',
    redirect: (context, state) {
      final isAuthenticated = authState.isAuthenticated;
      final isAuthRoute = state.matchedLocation == '/login' ||
          state.matchedLocation == '/register' ||
          state.matchedLocation == '/verify-email' ||
          state.matchedLocation == '/forgot-password' ||
          state.matchedLocation == '/reset-password';

      if (!isAuthenticated && !isAuthRoute) {
        return '/login';
      }
      if (isAuthenticated && isAuthRoute) {
        return '/dashboard';
      }
      return null;
    },
    routes: [
      // Auth routes (no bottom nav)
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/verify-email',
        builder: (context, state) {
          final email = state.uri.queryParameters['email'] ?? '';
          return VerifyEmailScreen(email: email);
        },
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      GoRoute(
        path: '/reset-password',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>?;
          return ResetPasswordScreen(email: extra?['email'] as String? ?? '');
        },
      ),
      // Main app routes (with bottom nav)
      ShellRoute(
        builder: (context, state, child) => ScaffoldWithNavBar(child: child),
        routes: [
          GoRoute(
            path: '/dashboard',
            pageBuilder: (context, state) => const NoTransitionPage(child: DashboardScreen()),
          ),
          GoRoute(
            path: '/routers',
            pageBuilder: (context, state) => const NoTransitionPage(child: RouterListScreen()),
          ),
          GoRoute(
            path: '/vouchers',
            pageBuilder: (context, state) => const NoTransitionPage(child: VoucherListScreen()),
          ),
          GoRoute(
            path: '/settings',
            pageBuilder: (context, state) => const NoTransitionPage(child: SettingsScreen()),
          ),
        ],
      ),
      // Subscription routes (pushed on top of nav, no bottom bar)
      GoRoute(
        path: '/subscription',
        builder: (context, state) => const SubscriptionStatusScreen(),
      ),
      GoRoute(
        path: '/subscription/payment',
        builder: (context, state) => const PaymentScreen(),
      ),
      // Router routes (pushed on top of nav, no bottom bar)
      GoRoute(
        path: '/routers/add',
        builder: (context, state) => const AddRouterScreen(),
      ),
      GoRoute(
        path: '/routers/detail',
        builder: (context, state) {
          final routerId = state.extra as String? ?? '';
          return RouterDetailScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/routers/edit',
        builder: (context, state) {
          final routerId = state.extra as String? ?? '';
          return EditRouterScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/routers/setup-guide',
        builder: (context, state) {
          final routerId = state.extra as String? ?? '';
          return SetupGuideScreen(routerId: routerId);
        },
      ),
      // Voucher routes
      GoRoute(
        path: '/vouchers/create',
        builder: (context, state) {
          final routerId = state.extra as String? ?? '';
          return CreateVoucherWizard(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/vouchers/detail',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>? ?? {};
          return VoucherDetailScreen(
            routerId: extra['routerId'] as String? ?? '',
            voucherId: extra['voucherId'] as String? ?? '',
          );
        },
      ),
      // Print routes
      GoRoute(
        path: '/vouchers/print',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>? ?? {};
          final vouchers = extra['vouchers'] as List<Voucher>? ?? [];
          final routerName = extra['routerName'] as String? ?? 'Wi-Fi';
          return VoucherPrintScreen(
            vouchers: vouchers,
            routerName: routerName,
          );
        },
      ),
      // Settings sub-routes
      GoRoute(
        path: '/settings/profile',
        builder: (context, state) => const EditProfileScreen(),
      ),
      GoRoute(
        path: '/settings/change-password',
        builder: (context, state) => const ChangePasswordScreen(),
      ),
      GoRoute(
        path: '/settings/payments',
        builder: (context, state) => const PaymentsScreen(),
      ),
      GoRoute(
        path: '/settings/contact',
        builder: (context, state) => const ContactScreen(),
      ),
      // Notifications
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      // Notification preferences
      GoRoute(
        path: '/notification-preferences',
        builder: (context, state) => const NotificationPreferencesScreen(),
      ),
      // Report routes
      GoRoute(
        path: '/reports',
        builder: (context, state) => const ReportsScreen(),
      ),
      GoRoute(
        path: '/reports/export',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>? ?? {};
          return ReportExportScreen(
            reportType: extra['reportType'] as String? ?? '',
            exportData: extra['exportData'] as String? ?? '',
          );
        },
      ),
      // Session routes
      GoRoute(
        path: '/sessions/active',
        builder: (context, state) {
          final routerId = state.extra as String? ?? '';
          return ActiveSessionsScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/sessions/history',
        builder: (context, state) {
          final routerId = state.extra as String? ?? '';
          return SessionHistoryScreen(routerId: routerId);
        },
      ),
    ],
  );
});

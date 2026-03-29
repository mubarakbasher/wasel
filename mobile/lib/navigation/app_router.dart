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
import '../screens/vouchers/create_voucher_screen.dart';
import '../screens/vouchers/bulk_create_screen.dart';
import '../screens/vouchers/voucher_detail_screen.dart';
import '../screens/settings_screen.dart';
import '../screens/profiles/profile_list_screen.dart';
import '../screens/profiles/create_profile_screen.dart';
import '../screens/profiles/edit_profile_screen.dart';
import '../screens/profiles/profile_detail_screen.dart';
import '../screens/sessions/active_sessions_screen.dart';
import '../screens/sessions/session_history_screen.dart';
import '../screens/subscription/plans_screen.dart';
import '../screens/subscription/subscription_status_screen.dart';
import '../screens/subscription/payment_screen.dart';
import 'scaffold_with_nav_bar.dart';

final appRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/login',
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
          final extra = state.extra as Map<String, dynamic>?;
          return VerifyEmailScreen(email: extra?['email'] as String? ?? '');
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
        path: '/subscription/plans',
        builder: (context, state) => const PlansScreen(),
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
          final routerId = state.extra as String;
          return RouterDetailScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/routers/edit',
        builder: (context, state) {
          final routerId = state.extra as String;
          return EditRouterScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/routers/setup-guide',
        builder: (context, state) {
          final routerId = state.extra as String;
          return SetupGuideScreen(routerId: routerId);
        },
      ),
      // Profile routes
      GoRoute(
        path: '/profiles',
        builder: (context, state) => const ProfileListScreen(),
      ),
      GoRoute(
        path: '/profiles/create',
        builder: (context, state) => const CreateProfileScreen(),
      ),
      GoRoute(
        path: '/profiles/detail',
        builder: (context, state) {
          final profileId = state.extra as String;
          return ProfileDetailScreen(profileId: profileId);
        },
      ),
      GoRoute(
        path: '/profiles/edit',
        builder: (context, state) {
          final profileId = state.extra as String;
          return EditProfileScreen(profileId: profileId);
        },
      ),
      // Voucher routes
      GoRoute(
        path: '/vouchers/create',
        builder: (context, state) {
          final routerId = state.extra as String;
          return CreateVoucherScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/vouchers/bulk-create',
        builder: (context, state) {
          final routerId = state.extra as String;
          return BulkCreateScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/vouchers/detail',
        builder: (context, state) {
          final extra = state.extra as Map<String, dynamic>;
          return VoucherDetailScreen(
            routerId: extra['routerId'] as String,
            voucherId: extra['voucherId'] as String,
          );
        },
      ),
      // Session routes
      GoRoute(
        path: '/sessions/active',
        builder: (context, state) {
          final routerId = state.extra as String;
          return ActiveSessionsScreen(routerId: routerId);
        },
      ),
      GoRoute(
        path: '/sessions/history',
        builder: (context, state) {
          final routerId = state.extra as String;
          return SessionHistoryScreen(routerId: routerId);
        },
      ),
    ],
  );
});

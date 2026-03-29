import 'package:flutter/material.dart';

/// Lightweight i18n system using in-memory maps keyed by dot-notation strings.
///
/// Usage:
/// ```dart
/// // In MaterialApp:
/// supportedLocales: AppLocalizations.supportedLocales,
/// localizationsDelegates: [
///   AppLocalizations.delegate,
///   GlobalMaterialLocalizations.delegate,
///   GlobalWidgetsLocalizations.delegate,
///   GlobalCupertinoLocalizations.delegate,
/// ],
///
/// // In widgets:
/// final t = AppLocalizations.of(context);
/// Text(t.translate('common.loading'));
/// // or with the shorthand extension:
/// Text(context.tr('common.loading'));
/// ```
class AppLocalizations {
  final Locale locale;

  AppLocalizations(this.locale);

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  static AppLocalizations of(BuildContext context) {
    return Localizations.of<AppLocalizations>(context, AppLocalizations)!;
  }

  static const LocalizationsDelegate<AppLocalizations> delegate =
      _AppLocalizationsDelegate();

  static const List<Locale> supportedLocales = [
    Locale('en'),
    // Phase 2: Locale('fr'), Locale('pt'), Locale('sw'), Locale('ar'),
  ];

  /// Return the translated value for [key], or the key itself if not found.
  /// Supports optional [args] for positional replacement of `{0}`, `{1}`, etc.
  String translate(String key, [List<String>? args]) {
    String value = _localizedValues[locale.languageCode]?[key] ?? key;
    if (args != null) {
      for (var i = 0; i < args.length; i++) {
        value = value.replaceAll('{$i}', args[i]);
      }
    }
    return value;
  }

  // ---------------------------------------------------------------------------
  // Translation data
  // ---------------------------------------------------------------------------

  static final Map<String, Map<String, String>> _localizedValues = {
    'en': _en,
  };

  static const Map<String, String> _en = {
    // ── Common ────────────────────────────────────────────────────────────────
    'common.loading': 'Loading...',
    'common.error': 'Something went wrong',
    'common.retry': 'Retry',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.save': 'Save',
    'common.delete': 'Delete',
    'common.edit': 'Edit',
    'common.search': 'Search',
    'common.noData': 'No data available',
    'common.success': 'Success',
    'common.back': 'Back',
    'common.yes': 'Yes',
    'common.no': 'No',
    'common.ok': 'OK',
    'common.close': 'Close',
    'common.done': 'Done',
    'common.next': 'Next',
    'common.previous': 'Previous',
    'common.required': 'This field is required',
    'common.optional': 'Optional',
    'common.copied': 'Copied to clipboard',

    // ── Tabs / Bottom Navigation ──────────────────────────────────────────────
    'tabs.dashboard': 'Dashboard',
    'tabs.routers': 'Routers',
    'tabs.vouchers': 'Vouchers',
    'tabs.settings': 'Settings',

    // ── Auth ──────────────────────────────────────────────────────────────────
    'auth.login': 'Log In',
    'auth.register': 'Create Account',
    'auth.email': 'Email',
    'auth.password': 'Password',
    'auth.forgotPassword': 'Forgot Password?',
    'auth.fullName': 'Full Name',
    'auth.phone': 'Phone Number',
    'auth.businessName': 'Business Name',
    'auth.verifyEmail': 'Verify Your Email',
    'auth.enterOtp': 'Enter Verification Code',
    'auth.resetPassword': 'Reset Password',
    'auth.newPassword': 'New Password',
    'auth.confirmPassword': 'Confirm Password',
    'auth.logout': 'Log Out',
    'auth.logoutConfirm': 'Are you sure you want to log out?',
    'auth.loginSubtitle': 'Sign in to manage your hotspot',
    'auth.registerSubtitle': 'Create an account to get started',
    'auth.emailHint': 'you@example.com',
    'auth.passwordHint': 'Enter your password',
    'auth.passwordMinLength': 'Password must be at least 8 characters',
    'auth.passwordsDoNotMatch': 'Passwords do not match',
    'auth.invalidEmail': 'Please enter a valid email address',
    'auth.noAccount': "Don't have an account?",
    'auth.hasAccount': 'Already have an account?',
    'auth.resetPasswordInstructions':
        'Enter the email associated with your account and we will send a reset link.',
    'auth.otpSent': 'A verification code has been sent to your email',
    'auth.resendOtp': 'Resend Code',
    'auth.agreeToTerms': 'By registering, you agree to our Terms of Service',

    // ── Dashboard ─────────────────────────────────────────────────────────────
    'dashboard.title': 'Dashboard',
    'dashboard.activeSessions': 'Active Sessions',
    'dashboard.vouchersToday': 'Vouchers Today',
    'dashboard.routerStatus': 'Router Status',
    'dashboard.subscriptionStatus': 'Subscription',
    'dashboard.quickCreate': 'Quick Create',
    'dashboard.dataUsage24h': 'Data Usage (24h)',
    'dashboard.welcome': 'Welcome back, {0}',
    'dashboard.noRouters': 'Add your first router to get started',
    'dashboard.totalVouchers': 'Total Vouchers',
    'dashboard.activeVouchers': 'Active Vouchers',

    // ── Routers ───────────────────────────────────────────────────────────────
    'routers.title': 'Routers',
    'routers.addRouter': 'Add Router',
    'routers.noRouters': 'No routers added yet',
    'routers.online': 'Online',
    'routers.offline': 'Offline',
    'routers.degraded': 'Degraded',
    'routers.lastSeen': 'Last seen {0}',
    'routers.setupGuide': 'Setup Guide',
    'routers.deleteRouter': 'Delete Router',
    'routers.deleteConfirm':
        'Are you sure you want to delete this router? This action cannot be undone.',
    'routers.routerName': 'Router Name',
    'routers.apiUsername': 'API Username',
    'routers.apiPassword': 'API Password',
    'routers.testConnection': 'Test Connection',
    'routers.connectionSuccess': 'Connection successful',
    'routers.connectionFailed': 'Connection failed',
    'routers.routerDetails': 'Router Details',
    'routers.model': 'Model',
    'routers.rosVersion': 'RouterOS Version',
    'routers.tunnelIp': 'Tunnel IP',
    'routers.nasIdentifier': 'NAS Identifier',
    'routers.editRouter': 'Edit Router',
    'routers.activeSessions': 'Active Sessions',
    'routers.totalVouchers': 'Total Vouchers',

    // ── Vouchers ──────────────────────────────────────────────────────────────
    'vouchers.title': 'Vouchers',
    'vouchers.createVoucher': 'Create Voucher',
    'vouchers.bulkCreate': 'Bulk Create',
    'vouchers.noVouchers': 'No vouchers created yet',
    'vouchers.active': 'Active',
    'vouchers.disabled': 'Disabled',
    'vouchers.expired': 'Expired',
    'vouchers.used': 'Used',
    'vouchers.username': 'Username',
    'vouchers.password': 'Password',
    'vouchers.profile': 'Profile',
    'vouchers.validUntil': 'Valid Until',
    'vouchers.timeUsed': 'Time Used',
    'vouchers.dataUsed': 'Data Used',
    'vouchers.sessions': 'Sessions',
    'vouchers.share': 'Share',
    'vouchers.print': 'Print',
    'vouchers.disable': 'Disable',
    'vouchers.enable': 'Enable',
    'vouchers.extend': 'Extend',
    'vouchers.quantity': 'Quantity',
    'vouchers.simultaneousUse': 'Simultaneous Use',
    'vouchers.comment': 'Comment',
    'vouchers.deleteVoucher': 'Delete Voucher',
    'vouchers.deleteConfirm':
        'Are you sure you want to delete this voucher? Active sessions will be disconnected.',
    'vouchers.selectRouter': 'Select Router',
    'vouchers.selectProfile': 'Select Profile',
    'vouchers.allRouters': 'All Routers',
    'vouchers.createdSuccessfully': 'Voucher created successfully',
    'vouchers.bulkCreatedSuccessfully': '{0} vouchers created successfully',
    'vouchers.voucherDetails': 'Voucher Details',
    'vouchers.status': 'Status',
    'vouchers.createdAt': 'Created',
    'vouchers.router': 'Router',

    // ── Sessions ──────────────────────────────────────────────────────────────
    'sessions.title': 'Active Sessions',
    'sessions.noSessions': 'No active sessions',
    'sessions.disconnect': 'Disconnect',
    'sessions.disconnectConfirm':
        'Are you sure you want to disconnect this session?',
    'sessions.ipAddress': 'IP Address',
    'sessions.macAddress': 'MAC Address',
    'sessions.uptime': 'Uptime',
    'sessions.dataUsed': 'Data Used',
    'sessions.idleTime': 'Idle Time',
    'sessions.history': 'Session History',
    'sessions.downloadTotal': 'Download',
    'sessions.uploadTotal': 'Upload',
    'sessions.disconnectedSuccessfully': 'Session disconnected',

    // ── Subscription ──────────────────────────────────────────────────────────
    'subscription.title': 'Subscription',
    'subscription.currentPlan': 'Current Plan',
    'subscription.status': 'Status',
    'subscription.voucherQuota': 'Voucher Quota',
    'subscription.daysRemaining': '{0} days remaining',
    'subscription.subscribe': 'Subscribe',
    'subscription.uploadReceipt': 'Upload Receipt',
    'subscription.pendingVerification': 'Pending Verification',
    'subscription.paymentInstructions': 'Payment Instructions',
    'subscription.bankDetails': 'Bank Details',
    'subscription.referenceCode': 'Reference Code',
    'subscription.starter': 'Starter',
    'subscription.professional': 'Professional',
    'subscription.enterprise': 'Enterprise',
    'subscription.monthlyPrice': '\${0}/month',
    'subscription.maxRouters': '{0} Routers',
    'subscription.monthlyVouchers': '{0} Vouchers/month',
    'subscription.unlimitedVouchers': 'Unlimited Vouchers',
    'subscription.active': 'Active',
    'subscription.expired': 'Expired',
    'subscription.pending': 'Pending',
    'subscription.cancelled': 'Cancelled',
    'subscription.vouchersUsed': '{0} of {1} used',

    // ── Settings ──────────────────────────────────────────────────────────────
    'settings.title': 'Settings',
    'settings.account': 'Account',
    'settings.profiles': 'RADIUS Profiles',
    'settings.language': 'Language',
    'settings.notifications': 'Notifications',
    'settings.about': 'About',
    'settings.version': 'Version {0}',
    'settings.editProfile': 'Edit Profile',
    'settings.changePassword': 'Change Password',
    'settings.deleteAccount': 'Delete Account',
    'settings.darkMode': 'Dark Mode',
    'settings.pushNotifications': 'Push Notifications',
    'settings.routerOfflineAlerts': 'Router Offline Alerts',
    'settings.privacyPolicy': 'Privacy Policy',
    'settings.termsOfService': 'Terms of Service',
    'settings.contactSupport': 'Contact Support',

    // ── RADIUS Profiles ───────────────────────────────────────────────────────
    'profiles.title': 'RADIUS Profiles',
    'profiles.createProfile': 'Create Profile',
    'profiles.noProfiles': 'No profiles created yet',
    'profiles.displayName': 'Display Name',
    'profiles.bandwidthUp': 'Upload Speed',
    'profiles.bandwidthDown': 'Download Speed',
    'profiles.sessionTimeout': 'Session Timeout',
    'profiles.totalTime': 'Total Time',
    'profiles.totalData': 'Total Data',
    'profiles.deleteProfile': 'Delete Profile',
    'profiles.deleteConfirm':
        'Are you sure you want to delete this profile? Vouchers using this profile will not be affected.',
    'profiles.editProfile': 'Edit Profile',
    'profiles.profileDetails': 'Profile Details',
    'profiles.groupName': 'Group Name',
    'profiles.vouchersUsingProfile': '{0} vouchers using this profile',

    // ── Validation ────────────────────────────────────────────────────────────
    'validation.required': 'This field is required',
    'validation.invalidEmail': 'Invalid email address',
    'validation.minLength': 'Must be at least {0} characters',
    'validation.maxLength': 'Must be at most {0} characters',
    'validation.numeric': 'Must be a number',
    'validation.positive': 'Must be greater than zero',

    // ── Errors ────────────────────────────────────────────────────────────────
    'error.network': 'No internet connection',
    'error.timeout': 'Request timed out. Please try again.',
    'error.server': 'Server error. Please try again later.',
    'error.unauthorized': 'Session expired. Please log in again.',
    'error.forbidden': 'You do not have permission to perform this action.',
    'error.notFound': 'The requested resource was not found.',
    'error.conflict': 'A conflict occurred. Please refresh and try again.',
    'error.unknown': 'An unexpected error occurred.',
    'error.quotaExceeded': 'You have reached your voucher quota for this month.',
    'error.routerOffline': 'Router is currently offline.',
  };
}

// -----------------------------------------------------------------------------
// Delegate
// -----------------------------------------------------------------------------

class _AppLocalizationsDelegate
    extends LocalizationsDelegate<AppLocalizations> {
  const _AppLocalizationsDelegate();

  @override
  bool isSupported(Locale locale) {
    return AppLocalizations.supportedLocales
        .map((l) => l.languageCode)
        .contains(locale.languageCode);
  }

  @override
  Future<AppLocalizations> load(Locale locale) async {
    return AppLocalizations(locale);
  }

  @override
  bool shouldReload(_AppLocalizationsDelegate old) => false;
}

// -----------------------------------------------------------------------------
// Convenience extension on BuildContext
// -----------------------------------------------------------------------------

extension AppLocalizationsX on BuildContext {
  AppLocalizations get l10n => AppLocalizations.of(this);

  /// Shorthand: `context.tr('common.loading')`.
  String tr(String key, [List<String>? args]) =>
      AppLocalizations.of(this).translate(key, args);
}

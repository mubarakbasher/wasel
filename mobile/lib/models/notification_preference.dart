class NotificationPreference {
  final String category;
  final bool enabled;

  const NotificationPreference({required this.category, required this.enabled});

  factory NotificationPreference.fromJson(Map<String, dynamic> json) {
    return NotificationPreference(
      category: json['category'] as String,
      enabled: json['enabled'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {'category': category, 'enabled': enabled};

  NotificationPreference copyWith({bool? enabled}) {
    return NotificationPreference(category: category, enabled: enabled ?? this.enabled);
  }

  String get displayName {
    switch (category) {
      case 'subscription_expiring': return 'notifications.category.subscriptionExpiring';
      case 'subscription_expired': return 'notifications.category.subscriptionExpired';
      case 'payment_confirmed': return 'notifications.category.paymentConfirmed';
      case 'router_offline': return 'notifications.category.routerOffline';
      case 'router_online': return 'notifications.category.routerOnline';
      case 'voucher_quota_low': return 'notifications.category.voucherQuotaLow';
      case 'bulk_creation_complete': return 'notifications.category.bulkCreationComplete';
      case 'support_reply': return 'notifications.category.supportReply';
      default: return category;
    }
  }

  String get sectionName {
    if (category.startsWith('subscription') || category == 'payment_confirmed') {
      return 'notifications.section.subscription';
    }
    if (category.startsWith('router')) return 'notifications.section.routers';
    if (category == 'support_reply') return 'notifications.section.subscription';
    return 'notifications.section.vouchers';
  }
}

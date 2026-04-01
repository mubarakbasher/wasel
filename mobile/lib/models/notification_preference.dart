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
      case 'subscription_expiring': return 'Subscription Expiring';
      case 'subscription_expired': return 'Subscription Expired';
      case 'payment_confirmed': return 'Payment Confirmed';
      case 'router_offline': return 'Router Offline';
      case 'router_online': return 'Router Online';
      case 'voucher_quota_low': return 'Voucher Quota Low';
      case 'bulk_creation_complete': return 'Bulk Creation Complete';
      default: return category;
    }
  }

  String get sectionName {
    if (category.startsWith('subscription') || category == 'payment_confirmed') return 'Subscription';
    if (category.startsWith('router')) return 'Routers';
    return 'Vouchers';
  }
}

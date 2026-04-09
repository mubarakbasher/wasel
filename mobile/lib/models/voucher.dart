class Voucher {
  final String id;
  final String userId;
  final String routerId;
  final String username;
  final String? password;
  final String? profileName;
  final String? groupProfile;
  final String? comment;
  final String status; // unused, active, used, expired, disabled
  final String? expiration;
  final int? simultaneousUse;
  final String? limitType; // 'time' or 'data'
  final int? limitValue; // normalized: seconds or bytes
  final String? limitUnit; // display unit: minutes, hours, days, MB, GB
  final int? usedValue; // how much time (seconds) or data (bytes) has been used
  final int? validitySeconds;
  final double? price;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Voucher({
    required this.id,
    required this.userId,
    required this.routerId,
    required this.username,
    this.password,
    this.profileName,
    this.groupProfile,
    this.comment,
    this.status = 'unused',
    this.expiration,
    this.simultaneousUse,
    this.limitType,
    this.limitValue,
    this.limitUnit,
    this.usedValue,
    this.validitySeconds,
    this.price,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isUnused => status == 'unused';
  bool get isActive => status == 'active';
  bool get isDisabled => status == 'disabled';
  bool get isExpired => status == 'expired';
  bool get isUsed => status == 'used';

  String get limitDisplayText {
    if (limitType == null || limitValue == null || limitUnit == null) {
      return profileName ?? 'Unknown';
    }
    // Reverse normalize to display value
    int displayValue;
    switch (limitUnit) {
      case 'minutes':
        displayValue = limitValue! ~/ 60;
        break;
      case 'hours':
        displayValue = limitValue! ~/ 3600;
        break;
      case 'days':
        displayValue = limitValue! ~/ 86400;
        break;
      case 'MB':
        displayValue = limitValue! ~/ (1024 * 1024);
        break;
      case 'GB':
        displayValue = limitValue! ~/ (1024 * 1024 * 1024);
        break;
      default:
        displayValue = limitValue!;
    }
    return '$displayValue $limitUnit';
  }

  /// Usage percentage (0.0 to 1.0), null if no limit/usage data
  double? get usagePercent {
    if (limitValue == null || limitValue == 0 || usedValue == null) return null;
    return (usedValue! / limitValue!).clamp(0.0, 1.0);
  }

  /// Human-readable usage text like "1.5 of 2 hours used"
  String? get usageDisplayText {
    if (limitType == null || limitValue == null || usedValue == null) return null;
    final usedDisplay = _formatValue(usedValue!, limitType!, limitUnit);
    final limitDisplay = _formatValue(limitValue!, limitType!, limitUnit);
    return '$usedDisplay of $limitDisplay used';
  }

  static String _formatValue(int value, String type, String? unit) {
    if (type == 'time') {
      switch (unit) {
        case 'minutes':
          return '${(value / 60).toStringAsFixed(1)} min';
        case 'hours':
          return '${(value / 3600).toStringAsFixed(1)} hrs';
        case 'days':
          return '${(value / 86400).toStringAsFixed(1)} days';
        default:
          // Fallback: auto-format seconds
          if (value < 3600) return '${(value / 60).toStringAsFixed(0)} min';
          if (value < 86400) return '${(value / 3600).toStringAsFixed(1)} hrs';
          return '${(value / 86400).toStringAsFixed(1)} days';
      }
    } else {
      // data
      switch (unit) {
        case 'MB':
          return '${(value / (1024 * 1024)).toStringAsFixed(1)} MB';
        case 'GB':
          return '${(value / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
        default:
          if (value < 1024 * 1024) return '${(value / 1024).toStringAsFixed(0)} KB';
          if (value < 1024 * 1024 * 1024) return '${(value / (1024 * 1024)).toStringAsFixed(1)} MB';
          return '${(value / (1024 * 1024 * 1024)).toStringAsFixed(2)} GB';
      }
    }
  }

  factory Voucher.fromJson(Map<String, dynamic> json) {
    return Voucher(
      id: json['id'] as String,
      userId: json['userId'] as String,
      routerId: json['routerId'] as String,
      username: json['username'] as String,
      password: json['password'] as String?,
      profileName: json['profileName'] as String?,
      groupProfile: json['groupProfile'] as String?,
      comment: json['comment'] as String?,
      status: json['status'] as String? ?? 'unused',
      expiration: json['expiration'] as String?,
      simultaneousUse: json['simultaneousUse'] != null
          ? int.parse(json['simultaneousUse'].toString())
          : null,
      limitType: json['limitType'] as String?,
      limitValue: json['limitValue'] != null
          ? int.parse(json['limitValue'].toString())
          : null,
      limitUnit: json['limitUnit'] as String?,
      usedValue: json['usedValue'] != null
          ? int.parse(json['usedValue'].toString())
          : null,
      validitySeconds: json['validitySeconds'] != null
          ? int.parse(json['validitySeconds'].toString())
          : null,
      price: json['price'] != null
          ? double.parse(json['price'].toString())
          : null,
      createdAt: DateTime.parse(json['createdAt'] as String),
      updatedAt: DateTime.parse(json['updatedAt'] as String),
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'userId': userId,
      'routerId': routerId,
      'username': username,
      'password': password,
      'profileName': profileName,
      'groupProfile': groupProfile,
      'comment': comment,
      'status': status,
      'expiration': expiration,
      'simultaneousUse': simultaneousUse,
      'limitType': limitType,
      'limitValue': limitValue,
      'limitUnit': limitUnit,
      'usedValue': usedValue,
      'validitySeconds': validitySeconds,
      'price': price,
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }
}

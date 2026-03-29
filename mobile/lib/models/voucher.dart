class Voucher {
  final String id;
  final String userId;
  final String routerId;
  final String username;
  final String? password;
  final String profileName;
  final String groupProfile;
  final String? comment;
  final String status; // active, disabled, expired, used
  final String? expiration;
  final int? simultaneousUse;
  final DateTime createdAt;
  final DateTime updatedAt;

  const Voucher({
    required this.id,
    required this.userId,
    required this.routerId,
    required this.username,
    this.password,
    required this.profileName,
    required this.groupProfile,
    this.comment,
    this.status = 'active',
    this.expiration,
    this.simultaneousUse,
    required this.createdAt,
    required this.updatedAt,
  });

  bool get isActive => status == 'active';
  bool get isDisabled => status == 'disabled';
  bool get isExpired => status == 'expired';
  bool get isUsed => status == 'used';

  factory Voucher.fromJson(Map<String, dynamic> json) {
    return Voucher(
      id: json['id'] as String,
      userId: json['userId'] as String,
      routerId: json['routerId'] as String,
      username: json['username'] as String,
      password: json['password'] as String?,
      profileName: json['profileName'] as String,
      groupProfile: json['groupProfile'] as String,
      comment: json['comment'] as String?,
      status: json['status'] as String? ?? 'active',
      expiration: json['expiration'] as String?,
      simultaneousUse: json['simultaneousUse'] as int?,
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
      'createdAt': createdAt.toIso8601String(),
      'updatedAt': updatedAt.toIso8601String(),
    };
  }
}

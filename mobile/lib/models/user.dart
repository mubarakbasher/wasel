class User {
  final String id;
  final String name;
  final String email;
  final String? phone;
  final String? businessName;
  final bool isVerified;

  const User({
    required this.id,
    required this.name,
    required this.email,
    this.phone,
    this.businessName,
    this.isVerified = false,
  });

  factory User.fromJson(Map<String, dynamic> json) {
    return User(
      id: json['id'] as String,
      name: json['name'] as String,
      email: json['email'] as String,
      phone: json['phone'] as String?,
      businessName: json['business_name'] as String?,
      isVerified: json['is_verified'] as bool? ?? false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'name': name,
      'email': email,
      'phone': phone,
      'business_name': businessName,
      'is_verified': isVerified,
    };
  }
}

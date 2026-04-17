class SupportMessage {
  final String id;
  final String sender; // 'user' | 'admin'
  final String body;
  final DateTime? readAt;
  final DateTime createdAt;

  const SupportMessage({
    required this.id,
    required this.sender,
    required this.body,
    required this.readAt,
    required this.createdAt,
  });

  bool get isUser => sender == 'user';
  bool get isAdmin => sender == 'admin';

  factory SupportMessage.fromJson(Map<String, dynamic> json) => SupportMessage(
        id: json['id'] as String,
        sender: json['sender'] as String,
        body: json['body'] as String,
        readAt: json['readAt'] != null
            ? DateTime.parse(json['readAt'] as String)
            : null,
        createdAt: DateTime.parse(json['createdAt'] as String),
      );
}

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
        id: json['id']?.toString() ?? '',
        sender: json['sender']?.toString() ?? '',
        body: json['body']?.toString() ?? '',
        readAt: json['readAt'] != null
            ? DateTime.tryParse(json['readAt'].toString())
            : null,
        createdAt:
            DateTime.tryParse(json['createdAt']?.toString() ?? '') ??
                DateTime.now(),
      );
}

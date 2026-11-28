use std::fmt;

/// Structured application error carrying an HTTP-equivalent status code.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AppError {
    pub message: String,
    pub status: u16,
}

impl AppError {
    pub fn new(message: impl Into<String>, status: u16) -> Self {
        Self {
            message: message.into(),
            status,
        }
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        Self::new(message, 400)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::new(message, 403)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::new(message, 404)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        Self::new(message, 409)
    }

    pub fn payload_too_large(message: impl Into<String>) -> Self {
        Self::new(message, 413)
    }

    pub fn unsupported_media_type(message: impl Into<String>) -> Self {
        Self::new(message, 415)
    }

    pub fn cancelled() -> Self {
        Self::new("Generation cancelled.", 499)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(message, 500)
    }

    pub fn bad_gateway(message: impl Into<String>) -> Self {
        Self::new(message, 502)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for AppError {}

pub type AppResult<T> = Result<T, AppError>;

import React, { memo } from "react";

interface FormattedMessageTextProps {
  text: string;
  className?: string;
  style?: React.CSSProperties;
}

// Regex matching URLs (http, https, www.)
const URL_REGEX = /(https?:\/\/[^\s<]+[^<.,:;"')\]\s]|www\.[^\s<]+[^<.,:;"')\]\s])/i;

// Regex matching phone numbers (7 to 15 digits with optional +, brackets, spaces, dashes)
const PHONE_REGEX = /(?:(?:\+|00)\d{1,3}[\s.-]?)?(?:\(?\d{2,4}\)?[\s.-]?)?\d{3,5}[\s.-]?\d{4,6}/;

// Combined token matcher
const TOKEN_REGEX = new RegExp(
  `(${URL_REGEX.source})|(${PHONE_REGEX.source})`,
  "gi"
);

export const FormattedMessageText = memo(function FormattedMessageText({
  text,
  className,
  style,
}: FormattedMessageTextProps) {
  if (!text) return null;

  // Split by line breaks first to preserve message structure
  const lines = text.split("\n");

  return (
    <span className={className} style={{ wordBreak: "break-word", ...style }}>
      {lines.map((line, lineIdx) => {
        if (!line) {
          return lineIdx < lines.length - 1 ? <br key={`br-${lineIdx}`} /> : null;
        }

        const elements: React.ReactNode[] = [];
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        // Reset regex state
        TOKEN_REGEX.lastIndex = 0;

        while ((match = TOKEN_REGEX.exec(line)) !== null) {
          const matchText = match[0];
          const startIndex = match.index;

          // Push plain text prior to match
          if (startIndex > lastIndex) {
            elements.push(line.substring(lastIndex, startIndex));
          }

          const isUrl = URL_REGEX.test(matchText);
          const digitsOnly = matchText.replace(/\D/g, "");

          if (isUrl) {
            const href = matchText.startsWith("http://") || matchText.startsWith("https://")
              ? matchText
              : `https://${matchText}`;

            elements.push(
              <a
                key={`url-${lineIdx}-${startIndex}`}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: "#53bdeb",
                  textDecoration: "underline",
                  wordBreak: "break-all",
                  cursor: "pointer",
                }}
              >
                {matchText}
              </a>
            );
          } else if (digitsOnly.length >= 7 && digitsOnly.length <= 15) {
            // Valid phone number length
            const telHref = matchText.startsWith("+") ? `tel:+${digitsOnly}` : `tel:${digitsOnly}`;

            elements.push(
              <a
                key={`phone-${lineIdx}-${startIndex}`}
                href={telHref}
                onClick={(e) => e.stopPropagation()}
                style={{
                  color: "#53bdeb",
                  textDecoration: "underline",
                  cursor: "pointer",
                }}
              >
                {matchText}
              </a>
            );
          } else {
            // Did not qualify as a valid phone number (e.g. short code or arbitrary digits)
            elements.push(matchText);
          }

          lastIndex = startIndex + matchText.length;
        }

        if (lastIndex < line.length) {
          elements.push(line.substring(lastIndex));
        }

        return (
          <React.Fragment key={`line-${lineIdx}`}>
            {elements}
            {lineIdx < lines.length - 1 && <br />}
          </React.Fragment>
        );
      })}
    </span>
  );
});

export default FormattedMessageText;

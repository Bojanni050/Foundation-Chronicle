from abc import ABC, abstractmethod
from typing import List, Dict, Optional, Tuple

class BaseProvider(ABC):
    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def profile_dir_name(self) -> str:
        pass

    @property
    @abstractmethod
    def start_url(self) -> str:
        pass

    @abstractmethod
    def is_logged_in(self, page) -> bool:
        pass

    @abstractmethod
    def collect_conversation_links(self, page, limit: Optional[int] = None) -> List[Tuple[str, str]]:
        """Returns a list of (url, title_hint) tuples"""
        pass

    @abstractmethod
    def collect_turns(self, page) -> Tuple[List[Dict], Optional[str], List[Dict]]:
        """Returns (turns, last_date_label, images)"""
        pass

    @abstractmethod
    def parse_relative_date_label(self, label: str) -> Optional[str]:
        """Returns ISO string or None"""
        pass
